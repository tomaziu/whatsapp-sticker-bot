const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const config = require("../config");
const { log } = require("./logger");

async function imageToSticker(input, options = {}) {
  const size = config.sticker.size;
  const fit = options.crop ? "cover" : "fill";

  const webp = await sharp(input)
    .rotate()
    .resize(size, size, { fit, position: "centre" })
    .webp({ quality: 85, effort: 5 })
    .toBuffer();

  return addStickerMetadata(webp);
}

async function videoToSticker(input, options = {}) {
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `sticker-input-${id}`);
  const outputPath = path.join(os.tmpdir(), `sticker-output-${id}.webp`);

  try {
    await fs.promises.writeFile(inputPath, input);

    const originalDuration = getVideoDuration(inputPath);
    if (originalDuration > config.sticker.maxDurationSec) {
      log(`Vídeo tem ${originalDuration.toFixed(1)}s; cortando para caber.`);
    }

    const attempts = buildVideoAttempts(options);
    let lastSizeKB = 0;

    for (const attempt of attempts) {
      const result = await convertVideoToWebp(inputPath, outputPath, attempt);
      lastSizeKB = result.sizeKB;

      if (result.sizeKB <= config.sticker.maxSizeKB) {
        return addStickerMetadata(await fs.promises.readFile(outputPath));
      }
    }

    throw new Error(`Vídeo ainda ficou com ${Math.round(lastSizeKB)}KB após compressão.`);
  } finally {
    safeUnlink(inputPath);
    safeUnlink(outputPath);
  }
}

async function stickerToImage(input) {
  return sharp(input)
    .rotate()
    .png()
    .toBuffer();
}

async function textToSticker(text) {
  const webp = await renderTextFrame(text, { frame: 0, rgb: false })
    .webp({ quality: 88, effort: 5 })
    .toBuffer();

  return addStickerMetadata(webp);
}

async function rgbTextToSticker(text) {
  const id = crypto.randomUUID();
  const dir = path.join(os.tmpdir(), `rgb-text-sticker-${id}`);
  const outputPath = path.join(os.tmpdir(), `rgb-text-sticker-${id}.webp`);

  try {
    await fs.promises.mkdir(dir, { recursive: true });

    const frameCount = 18;
    for (let frame = 0; frame < frameCount; frame++) {
      const framePath = path.join(dir, `frame-${String(frame).padStart(3, "0")}.png`);
      await renderTextFrame(text, { frame, rgb: true }).png().toFile(framePath);
    }

    await convertFramesToAnimatedWebp(path.join(dir, "frame-%03d.png"), outputPath);
    return addStickerMetadata(await fs.promises.readFile(outputPath));
  } finally {
    safeRm(dir);
    safeUnlink(outputPath);
  }
}

function renderTextFrame(text, options = {}) {
  const svg = createTextStickerSvg(text, options);
  return sharp(Buffer.from(svg)).resize(config.sticker.size, config.sticker.size, { fit: "fill" });
}

function createTextStickerSvg(text, options = {}) {
  const size = config.sticker.size;
  const cleanText = sanitizeStickerText(text);
  const lines = wrapStickerText(cleanText);
  const fontSize = getTextFontSize(lines);
  const lineHeight = Math.round(fontSize * 1.18);
  const totalHeight = lineHeight * lines.length;
  const startY = Math.round((size - totalHeight) / 2 + fontSize * 0.86);
  const textNodes = [];

  lines.forEach((line, lineIndex) => {
    const characters = [...line];
    const charWidth = fontSize * 0.58;
    const totalWidth = Math.max(1, characters.length) * charWidth;
    let x = (size - totalWidth) / 2 + charWidth / 2;
    const y = startY + lineIndex * lineHeight;

    characters.forEach((char, charIndex) => {
      const color = options.rgb
        ? getRgbTextColor(charIndex + lineIndex * 3, options.frame || 0)
        : "#ffffff";
      const escaped = escapeXml(char);

      textNodes.push(`<text x="${x.toFixed(1)}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900" fill="${color}" stroke="#000000" stroke-width="${Math.max(4, Math.round(fontSize * 0.08))}" paint-order="stroke" dominant-baseline="middle">${escaped}</text>`);
      x += charWidth;
    });
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="transparent"/>
  ${textNodes.join("\n  ")}
</svg>`;
}

function sanitizeStickerText(text = "") {
  return String(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "t00m4ziow";
}

function wrapStickerText(text) {
  const words = sanitizeStickerText(text).split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 12 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.flatMap((line) => splitLongLine(line, 14)).slice(0, 5);
}

function splitLongLine(line, maxLength) {
  if (line.length <= maxLength) return [line];

  const parts = [];
  for (let index = 0; index < line.length; index += maxLength) {
    parts.push(line.slice(index, index + maxLength));
  }
  return parts;
}

function getTextFontSize(lines) {
  const longest = Math.max(...lines.map((line) => [...line].length), 1);
  const byWidth = Math.floor(430 / Math.max(longest * 0.58, 1));
  const byHeight = Math.floor(390 / Math.max(lines.length * 1.18, 1));
  return Math.max(42, Math.min(104, byWidth, byHeight));
}

function getRgbTextColor(index, frame) {
  const hue = (frame * 22 + index * 36) % 360;
  return `hsl(${hue}, 100%, 62%)`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function convertFramesToAnimatedWebp(inputPattern, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPattern)
      .inputOptions(["-framerate", "12"])
      .outputOptions([
        "-vcodec", "libwebp",
        "-lossless", "0",
        "-q:v", "72",
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0",
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

function addStickerMetadata(webpBuffer, metadata = {}) {
  const exif = createStickerExif(metadata);
  return insertWebpChunk(webpBuffer, "EXIF", exif);
}

function replaceStickerMetadata(webpBuffer) {
  return addStickerMetadata(webpBuffer, {
    packId: config.sticker.packId,
    packname: config.sticker.packname,
    author: config.sticker.author,
    emojis: config.sticker.emojis,
  });
}

function createStickerExif(metadata = {}) {
  const payload = {
    "sticker-pack-id": metadata.packId || config.sticker.packId,
    "sticker-pack-name": metadata.packname || config.sticker.packname,
    "sticker-pack-publisher": metadata.author || config.sticker.author,
    emojis: metadata.emojis || config.sticker.emojis,
  };

  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const tiffHeader = Buffer.from([
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x41, 0x57,
    0x07, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x16, 0x00, 0x00, 0x00,
  ]);

  tiffHeader.writeUInt32LE(json.length, 14);
  return Buffer.concat([tiffHeader, json]);
}

function insertWebpChunk(webpBuffer, chunkType, chunkData) {
  if (webpBuffer.toString("ascii", 0, 4) !== "RIFF" || webpBuffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Arquivo WebP inválido.");
  }

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(chunkType, 0, 4, "ascii");
  chunkHeader.writeUInt32LE(chunkData.length, 4);

  const padding = chunkData.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
  const chunk = Buffer.concat([chunkHeader, chunkData, padding]);
  const cleanWebp = ensureVp8xFeature(removeWebpChunks(webpBuffer, chunkType), chunkType);
  const output = Buffer.concat([cleanWebp, chunk]);
  output.writeUInt32LE(output.length - 8, 4);

  return output;
}

function ensureVp8xFeature(webpBuffer, chunkType) {
  const flag = getVp8xFeatureFlag(chunkType);
  if (!flag) return webpBuffer;

  const firstChunkType = webpBuffer.toString("ascii", 12, 16);

  if (firstChunkType === "VP8X") {
    const output = Buffer.from(webpBuffer);
    output[20] = output[20] | flag;
    return output;
  }

  const dimensions = readWebpDimensions(webpBuffer);
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, 4, "ascii");
  vp8x.writeUInt32LE(10, 4);
  vp8x[8] = flag;
  vp8x.writeUIntLE(dimensions.width - 1, 12, 3);
  vp8x.writeUIntLE(dimensions.height - 1, 15, 3);

  const output = Buffer.concat([
    webpBuffer.subarray(0, 12),
    vp8x,
    webpBuffer.subarray(12),
  ]);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

function getVp8xFeatureFlag(chunkType) {
  if (chunkType === "EXIF") return 0x08;
  if (chunkType === "XMP ") return 0x04;
  if (chunkType === "ICCP") return 0x20;
  return 0;
}

function readWebpDimensions(webpBuffer) {
  let offset = 12;

  while (offset + 8 <= webpBuffer.length) {
    const type = webpBuffer.toString("ascii", offset, offset + 4);
    const size = webpBuffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (type === "VP8X") {
      return {
        width: webpBuffer.readUIntLE(dataOffset + 4, 3) + 1,
        height: webpBuffer.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }

    if (type === "VP8 " && size >= 10) {
      return {
        width: webpBuffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: webpBuffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    if (type === "VP8L" && size >= 5) {
      const bits = webpBuffer.readUInt32LE(dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    offset += 8 + size + (size % 2);
  }

  return { width: config.sticker.size, height: config.sticker.size };
}

function removeWebpChunks(webpBuffer, chunkType) {
  const header = webpBuffer.subarray(0, 12);
  const chunks = [];
  let offset = 12;

  while (offset + 8 <= webpBuffer.length) {
    const type = webpBuffer.toString("ascii", offset, offset + 4);
    const size = webpBuffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);

    if (end > webpBuffer.length) break;
    if (type !== chunkType) chunks.push(webpBuffer.subarray(offset, end));
    offset = end;
  }

  return Buffer.concat([header, ...chunks]);
}

function buildVideoAttempts(options = {}) {
  const durations = uniqueNumbers([
    config.sticker.maxDurationSec,
    5,
    4,
    3,
    config.sticker.minDurationSec,
  ]).filter((value) => value >= config.sticker.minDurationSec);

  const sizes = uniqueNumbers([config.sticker.size, 448, 384, 320]);
  const fpsValues = uniqueNumbers([config.sticker.fps, 12, 10, 8, 6, 5]);
  const qualities = [72, 62, 52, 42, 32, 24];

  const attempts = [];
  for (const duration of durations) {
    for (const size of sizes) {
      for (const fps of fpsValues) {
        for (const quality of qualities) {
          attempts.push({ duration, size, fps, quality, crop: !!options.crop });
        }
      }
    }
  }

  return attempts;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))];
}

function convertVideoToWebp(inputPath, outputPath, attempt) {
  const filter = buildVideoFilter(attempt);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", filter,
        "-lossless", "0",
        "-q:v", String(attempt.quality),
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0",
        "-t", String(attempt.duration),
      ])
      .output(outputPath)
      .on("end", () => {
        try {
          resolve({ sizeKB: fs.statSync(outputPath).size / 1024 });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", reject)
      .run();
  });
}

function buildVideoFilter(attempt) {
  const filters = [
    `fps=${attempt.fps}`,
  ];

  if (attempt.crop) {
    filters.push("crop='min(iw,ih)':'min(iw,ih)'");
  }

  filters.push(`scale=${attempt.size}:${attempt.size}`);

  return filters.join(",");
}

function getVideoDuration(filePath) {
  try {
    const output = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { encoding: "utf8", timeout: 10000 });

    return Number.parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function safeRm(targetPath) {
  try {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
}

module.exports = {
  imageToSticker,
  replaceStickerMetadata,
  rgbTextToSticker,
  stickerToImage,
  textToSticker,
  videoToSticker,
  _private: {
    buildVideoAttempts,
    buildVideoFilter,
    convertVideoToWebp,
    convertFramesToAnimatedWebp,
    addStickerMetadata,
    createTextStickerSvg,
    createStickerExif,
    escapeXml,
    getRgbTextColor,
    getVideoDuration,
    ensureVp8xFeature,
    getVp8xFeatureFlag,
    insertWebpChunk,
    readWebpDimensions,
    renderTextFrame,
    safeUnlink,
    safeRm,
    sanitizeStickerText,
    wrapStickerText,
    uniqueNumbers,
  },
};
