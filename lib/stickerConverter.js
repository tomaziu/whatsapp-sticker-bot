/**
 * lib/stickerConverter.js
 * Funções de conversão de mídia para figurinhas WebP.
 *
 * - imageToSticker: converte imagem estática (jpg/png) para WebP 512x512
 * - videoToSticker: converte vídeo/GIF para WebP animado dentro dos limites do WhatsApp
 */
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const config = require("../config");

/**
 * Converte uma imagem estática em figurinha WebP 512x512.
 * @param {Buffer} imageBuffer - Buffer da imagem original (jpg/png/webp)
 * @returns {Promise<Buffer>} Buffer da figurinha WebP
 */
async function imageToSticker(imageBuffer) {
  const { maxWidth, maxHeight } = config.sticker;

  return sharp(imageBuffer)
    .resize(maxWidth, maxHeight, {
      fit: "fill",           // Estica para preencher 512x512 (1:1)
    })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Converte vídeo/GIF em figurinha WebP animado.
 * Se ultrapassar o tamanho máximo, reduz FPS e bitrate até caber.
 * @param {Buffer} videoBuffer - Buffer do vídeo/GIF original
 * @returns {Promise<Buffer>} Buffer do WebP animado
 */
async function videoToSticker(videoBuffer) {
  const { maxSizeKB, maxDurationSec, defaultFps, defaultBitrate } = config.sticker;

  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `sticker_input_${Date.now()}.mp4`);
  const tmpOutput = path.join(tmpDir, `sticker_output_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tmpInput, videoBuffer);

    // Detecta duração do vídeo via ffprobe
    const duration = getVideoDuration(tmpInput);
    if (duration > maxDurationSec) {
      console.log(`[Converter] Vídeo ${duration.toFixed(1)}s > ${maxDurationSec}s — cortando para ${maxDurationSec}s`);
    }

    let fps = defaultFps;
    let bitrate = defaultBitrate;

    // Tenta converter; se o resultado for grande demais, reduz qualidade
    let result = await convertVideoToWebp(tmpInput, tmpOutput, fps, bitrate);
    let attempts = 0;

    while (result.sizeKB > maxSizeKB && attempts < 10) {
      attempts++;
      console.log(
        `[Converter] WebP ${result.sizeKB.toFixed(0)}KB > ${maxSizeKB}KB — reduzindo (tentativa ${attempts})...`
      );
      fps = Math.max(5, fps - 2);
      const numBitrate = parseInt(bitrate) * 0.6;
      bitrate = `${Math.round(numBitrate)}k`;
      result = await convertVideoToWebp(tmpInput, tmpOutput, fps, bitrate);
    }

    if (result.sizeKB > maxSizeKB) {
      // Último recurso: redimensionar para 384x384
      console.log(`[Converter] Tentando resolução menor (384x384)...`);
      const smallResult = await convertVideoToWebpSmall(tmpInput, tmpOutput, fps, bitrate);
      if (smallResult.sizeKB > maxSizeKB) {
        throw new Error(`Não foi possível comprimir para ${maxSizeKB}KB.`);
      }
      result = smallResult;
    }

    return fs.readFileSync(tmpOutput);
  } finally {
    safeUnlink(tmpInput);
    safeUnlink(tmpOutput);
  }
}

/**
 * Executa a conversão de vídeo para WebP via ffmpeg.
 * @param {string} inputPath - Caminho do arquivo de entrada
 * @param {string} outputPath - Caminho do arquivo de saída WebP
 * @param {number} fps - Frames por segundo
 * @param {string} bitrate - Bitrate (ex: "200k")
 * @returns {Promise<{sizeKB: number}>} Tamanho do resultado em KB
 */
function convertVideoToWebp(inputPath, outputPath, fps, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec libwebp",          // Codec WebP para animação
        "-vf", "scale=512:512",      // Estica para preencher 512x512 (1:1)
        "-r", String(fps),
        "-lossless", "0",
        "-q:v", "60",
        "-loop", "0",               // Loop infinito
        "-preset", "default",
        "-an",                      // Remove áudio
        "-t", String(config.sticker.maxDurationSec),
      ])
      .output(outputPath)
      .on("end", () => {
        try {
          const stats = fs.statSync(outputPath);
          const sizeKB = stats.size / 1024;
          resolve({ sizeKB });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * Último recurso: converte vídeo em 384x384 para caber em 500KB.
 */
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
          const stats = fs.statSync(outputPath);
          const sizeKB = stats.size / 1024;
          resolve({ sizeKB });
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * Obtém a duração de um vídeo em segundos via ffprobe.
 * @param {string} filePath - Caminho do arquivo de vídeo
 * @returns {number} Duração em segundos
 */
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

/**
 * Remove arquivo de forma segura (ignora erro se não existir).
 */
function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

module.exports = { imageToSticker, videoToSticker };
