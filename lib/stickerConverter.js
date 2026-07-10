/**
 * lib/stickerConverter.js — Conversão de mídia para figurinhas WebP
 */
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");
const config = require("../config");
const { log } = require("./logger");

async function imageToSticker(imageBuffer) {
  const { maxWidth, maxHeight } = config.sticker;
  return sharp(imageBuffer)
    .resize(maxWidth, maxHeight, { fit: "fill" })
    .webp({ quality: 80 })
    .toBuffer();
}

async function videoToSticker(videoBuffer) {
  const { maxSizeKB, maxDurationSec, defaultFps, defaultBitrate } = config.sticker;

  const uid = crypto.randomUUID();
  const tmpInput = path.join(os.tmpdir(), `sticker_${uid}.mp4`);
  const tmpOutput = path.join(os.tmpdir(), `sticker_${uid}.webp`);

  try {
    await fs.promises.writeFile(tmpInput, videoBuffer);

    const duration = getVideoDuration(tmpInput);
    if (duration > maxDurationSec) {
      log(`Vídeo ${duration.toFixed(1)}s > ${maxDurationSec}s — cortando`);
    }

    let fps = defaultFps;
    let bitrate = defaultBitrate;

    let result = await convertVideoToWebp(tmpInput, tmpOutput, fps, bitrate);
    let attempts = 0;

    while (result.sizeKB > maxSizeKB && attempts < 10) {
      attempts++;
      fps = Math.max(5, fps - 2);
      const numBitrate = (parseInt(bitrate) || 200) * 0.6;
      bitrate = `${Math.round(numBitrate)}k`;
      result = await convertVideoToWebp(tmpInput, tmpOutput, fps, bitrate);
    }

    if (result.sizeKB > maxSizeKB) {
      const smallResult = await convertVideoToWebpSmall(tmpInput, tmpOutput, fps, bitrate);
      if (smallResult.sizeKB > maxSizeKB) {
        throw new Error(`Não foi possível comprimir para ${maxSizeKB}KB.`);
      }
      result = smallResult;
    }

    return await fs.promises.readFile(tmpOutput);
  } finally {
    safeUnlink(tmpInput);
    safeUnlink(tmpOutput);
  }
}

function convertVideoToWebp(inputPath, outputPath, fps, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec libwebp",
        "-vf", "scale=512:512",
        "-r", String(fps),
        "-lossless", "0",
        "-q:v", "60",
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-t", String(config.sticker.maxDurationSec),
      ])
      .output(outputPath)
      .on("end", () => {
        try {
          const sizeKB = fs.statSync(outputPath).size / 1024;
          resolve({ sizeKB });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

function convertVideoToWebpSmall(inputPath, outputPath, fps, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec libwebp",
        "-vf", "scale=384:384",
        "-r", String(Math.max(5, fps)),
        "-lossless", "0",
        "-q:v", "40",
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-t", String(config.sticker.maxDurationSec),
      ])
      .output(outputPath)
      .on("end", () => {
        try {
          const sizeKB = fs.statSync(outputPath).size / 1024;
          resolve({ sizeKB });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

function getVideoDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return parseFloat(result.trim()) || 0;
  } catch {
    return 0;
  }
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

module.exports = { imageToSticker, videoToSticker };
