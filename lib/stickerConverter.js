const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const config = require("../config");
const { log } = require("./logger");

async function imageToSticker(input) {
  const size = config.sticker.size;

  const webp = await sharp(input)
    .rotate()
    .resize(size, size, { fit: "fill" })
    .webp({ quality: 85, effort: 5 })
    .toBuffer();

  return addStickerMetadata(webp);
}

async function videoToSticker(input) {
  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `sticker-input-${id}`);
  const outputPath = path.join(os.tmpdir(), `sticker-output-${id}.webp`);

  try {
    await fs.promises.writeFile(inputPath, input);

    const originalDuration = getVideoDuration(inputPath);
    if (originalDuration > config.sticker.maxDurationSec) {
      log(`Vídeo tem ${originalDuration.toFixed(1)}s; cortando para caber.`);
    }

    const attempts = buildVideoAttempts();
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

function addStickerMetadata(webpBuffer, metadata = {}) {
  const exif = createStickerExif(metadata);
  return insertWebpChunk(webpBuffer, "EXIF", exif);
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

function buildVideoAttempts() {
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
          attempts.push({ duration, size, fps, quality });
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
  return [
    `fps=${attempt.fps}`,
    `scale=${attempt.size}:${attempt.size}`,
  ].join(",");
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

module.exports = {
  imageToSticker,
  videoToSticker,
  _private: {
    buildVideoAttempts,
    buildVideoFilter,
    convertVideoToWebp,
    addStickerMetadata,
    createStickerExif,
    getVideoDuration,
    ensureVp8xFeature,
    getVp8xFeatureFlag,
    insertWebpChunk,
    readWebpDimensions,
    safeUnlink,
    uniqueNumbers,
  },
};
