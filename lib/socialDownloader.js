const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const config = require("../config");

const LOCAL_YT_DLP_BIN = path.join(os.homedir(), ".local", "bin", "yt-dlp");
const YT_DLP_BIN = process.env.YT_DLP_BIN || (fs.existsSync(LOCAL_YT_DLP_BIN) ? LOCAL_YT_DLP_BIN : "yt-dlp");
const YT_COOKIES = path.join(__dirname, "..", "cookies_youtube.txt");
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

function bytesFromMB(value) {
  return Math.max(1, Number(value || 1)) * 1024 * 1024;
}

function normalizeText(text = "") {
  return String(text || "").trim();
}

async function getSpotifyInfo(url) {
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  const response = await fetch(oembedUrl);
  if (!response.ok) throw new Error(`Spotify oembed falhou: HTTP ${response.status}`);
  const data = await response.json();
  const title = String(data?.title || "Spotify").trim() || null;
  if (!title) throw new Error("Título não encontrado no Spotify");
  return { title, artist: "" };
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getProviderFromUrl(url = "") {
  if (!isValidHttpUrl(url)) return "";
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "tiktok.com" || host.endsWith(".tiktok.com") || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return "tiktok";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return "instagram";
  }
  if (host === "open.spotify.com" || host.endsWith(".spotify.com")) {
    return "spotify";
  }
  return "";
}

function parseSocialDownloadCommand(text = "") {
  const raw = normalizeText(text);
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = String(parts[0] || "").toLowerCase();

  let provider = "";
  if (command === config.commands.tiktokDownload) provider = "tiktok";
  if (command === config.commands.instagramDownload) provider = "instagram";
  if (command === config.commands.spotifyDownload) provider = "spotify";
  if (!provider) return null;

  if (parts.length < 2) return { type: "invalid", provider, mode: "video", url: "" };

  let mode = "video";
  if (provider === "spotify") mode = "audio";
  let urlIndex = 1;
  const maybeMode = String(parts[1] || "").toLowerCase();
  if (["audio", "mp3", "musica", "música"].includes(maybeMode)) {
    mode = "audio";
    urlIndex = 2;
  } else if (["video", "vídeo"].includes(maybeMode)) {
    mode = "video";
    urlIndex = 2;
  }

  if (parts.length !== urlIndex + 1) return { type: "invalid", provider, mode, url: parts[urlIndex] || "" };

  const url = parts[urlIndex] || "";
  if (!isValidHttpUrl(url)) return { type: "invalid", provider, mode, url };
  if (getProviderFromUrl(url) !== provider) return { type: "wrong_provider", provider, mode, url };

  return { type: "download", provider, mode, url };
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: config.socialDownload.timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function getInfo(url) {
  const { stdout } = await runFile(YT_DLP_BIN, [
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    ...cookiesArgs(),
    url,
  ]);
  return JSON.parse(stdout);
}

async function ytDlpGetInfo(url) {
  const { stdout } = await runFile(YT_DLP_BIN, [
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--cookies", YT_COOKIES,
    url,
  ]);
  return JSON.parse(stdout);
}

function validateInfo(info) {
  const duration = Number(info?.duration || 0);
  if (duration && duration > config.socialDownload.maxDurationSec) {
    return { ok: false, reason: "duration", duration };
  }
  return { ok: true, duration };
}

function cookiesArgs() {
  return fs.existsSync(YT_COOKIES) ? ["--cookies", YT_COOKIES] : [];
}

async function downloadSocialMedia(command) {
  let info;
  let url = command.url;

  if (command.provider === "spotify") {
    const spotifyInfo = await getSpotifyInfo(url);
    const searchQuery = `${spotifyInfo.title} ${spotifyInfo.artist}`.trim();
    url = `ytsearch1:${searchQuery}`;
    try {
      info = await ytDlpGetInfo(url);
    } catch {
      info = await getInfo(url);
    }
  } else {
    info = await getInfo(url);
  }

  const validation = validateInfo(info);
  if (!validation.ok) return validation;

  const id = crypto.randomUUID();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `social-download-${id}-`));
  const outputPattern = path.join(tempDir, "media.%(ext)s");
  const title = String(info?.title || command.provider).slice(0, 80);

  try {
    const downloadedPath = command.mode === "audio"
      ? await downloadAudio(url, outputPattern, tempDir)
      : await downloadVideo(url, outputPattern, tempDir);

    const prepared = command.mode === "audio"
      ? await prepareAudio(downloadedPath, tempDir)
      : await prepareVideo(downloadedPath, tempDir);
    if (!prepared?.path) return prepared;

    return {
      ok: true,
      mode: command.mode,
      provider: command.provider,
      title,
      duration: validation.duration,
      buffer: await fs.promises.readFile(prepared.path),
      mimetype: prepared.mimetype,
      ext: prepared.ext,
      size: fs.statSync(prepared.path).size,
    };
  } finally {
    safeRm(tempDir);
  }
}

async function downloadVideo(url, outputPattern, tempDir) {
  await runFile(YT_DLP_BIN, [
    "--no-playlist",
    "--no-warnings",
    "--max-filesize", `${config.socialDownload.maxDownloadMB}M`,
    ...cookiesArgs(),
    "-f", "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]/best",
    "--merge-output-format", "mp4",
    "-o", outputPattern,
    url,
  ]);
  return findNewestFile(tempDir);
}

async function downloadAudio(url, outputPattern, tempDir) {
  await runFile(YT_DLP_BIN, [
    "--no-playlist",
    "--no-warnings",
    "--max-filesize", `${config.socialDownload.maxDownloadMB}M`,
    ...cookiesArgs(),
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "-o", outputPattern,
    url,
  ]);
  return findNewestFile(tempDir);
}

async function prepareVideo(inputPath, tempDir) {
  const maxBytes = bytesFromMB(config.socialDownload.maxSendVideoMB);
  if (fs.statSync(inputPath).size <= maxBytes && path.extname(inputPath).toLowerCase() === ".mp4") {
    return { path: inputPath, mimetype: "video/mp4", ext: "mp4" };
  }

  const outputPath = path.join(tempDir, "compressed.mp4");
  await runFile(FFMPEG_BIN, [
    "-y",
    "-i", inputPath,
    "-vf", "scale='min(720,iw)':-2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "30",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    outputPath,
  ]);

  if (fs.statSync(outputPath).size > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  return { path: outputPath, mimetype: "video/mp4", ext: "mp4" };
}

async function prepareAudio(inputPath, tempDir) {
  const maxBytes = bytesFromMB(config.socialDownload.maxSendAudioMB);
  if (fs.statSync(inputPath).size <= maxBytes && path.extname(inputPath).toLowerCase() === ".mp3") {
    return { path: inputPath, mimetype: "audio/mpeg", ext: "mp3" };
  }

  const outputPath = path.join(tempDir, "compressed.mp3");
  await runFile(FFMPEG_BIN, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "96k",
    outputPath,
  ]);

  if (fs.statSync(outputPath).size > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  return { path: outputPath, mimetype: "audio/mpeg", ext: "mp3" };
}

function findNewestFile(dir) {
  const files = fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files[0]) throw new Error("Nenhum arquivo baixado");
  return files[0];
}

function safeRm(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
}

module.exports = {
  downloadSocialMedia,
  getProviderFromUrl,
  getSpotifyInfo,
  isValidHttpUrl,
  parseSocialDownloadCommand,
  _private: {
    bytesFromMB,
    findNewestFile,
    getInfo,
    prepareAudio,
    prepareVideo,
    runFile,
    safeRm,
    validateInfo,
    ytDlpGetInfo,
  },
};
