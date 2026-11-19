const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const config = require("../config");

let ytDlpVersionLogged = false;

function getYtDlpPath() {
  const envBin = process.env.YT_DLP_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;

  const localBin = path.join(os.homedir(), ".local", "bin", "yt-dlp");
  if (fs.existsSync(localBin)) return localBin;

  const pythonVersions = ["315", "314", "313", "312", "311", "310"];
  for (const ver of pythonVersions) {
    const pipBin = path.join(os.homedir(), "AppData", "Roaming", "Python", `Python${ver}`, "Scripts", "yt-dlp.exe");
    if (fs.existsSync(pipBin)) return pipBin;
  }

  return "yt-dlp";
}

function resolveCookiePath(cookieConfig) {
  if (!cookieConfig) return null;
  const p = path.resolve(process.cwd(), cookieConfig);
  if (fs.existsSync(p)) return p;
  return null;
}

function findCookiesFile(provider) {
  const baseNames = ["cookies-tiktok.txt", "tiktok-cookies.txt", "cookies.txt"];

  const searchDirs = [
    process.cwd(),
    path.join(process.cwd(), "cookies"),
    path.join(os.homedir(), ".config", "yt-dlp"),
    path.join(os.homedir(), "cookies"),
  ];

  for (const dir of searchDirs) {
    for (const name of baseNames) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function getPlatformArgs(provider) {
  const args = [];
  const cookiesConfig = config.socialDownload?.cookies || {};
  const isTikTok = provider === "tiktok";

  let cookiePath = isTikTok ? cookiesConfig.tiktok : null;
  cookiePath = resolveCookiePath(cookiePath) || findCookiesFile(provider);

  if (cookiePath) {
    args.push("--cookies", cookiePath);
    console.log(`[SocialDownloader] Using cookies: ${cookiePath}`);
  } else {
    console.log(`[SocialDownloader] No cookies found for ${provider} (IP residencial pode funcionar sem cookies)`);
  }

  if (isTikTok) {
    args.push(
      "--user-agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "--add-header", "Accept-Language:pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "--extractor-args", "tiktok:webpage_download=True"
    );
  }
  return args;
}

function logYtDlpVersion() {
  if (ytDlpVersionLogged) return;
  const bin = getYtDlpPath();
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    console.log(`[SocialDownloader] yt-dlp version: ${out.trim()} (${bin})`);
  } catch (e) {
    console.warn(`[SocialDownloader] yt-dlp não encontrado em "${bin}". Instale com: pip install -U yt-dlp`);
  }
  ytDlpVersionLogged = true;
}

function bytesFromMB(value) {
  return Math.max(1, Number(value || 1)) * 1024 * 1024;
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

function mapYtDlpError(stderr, provider) {
  const msg = stderr || "";
  if (msg.includes("Video not available") || msg.includes("status code 0")) {
    return "TIKTOK_BLOCKED: Vídeo indisponível ou bloqueado pelo TikTok. Se roda em PC doméstico, tente atualizar yt-dlp (pip install -U yt-dlp) ou adicione cookies em config.js > socialDownload.cookies.tiktok";
  }
  if (msg.includes("empty media response") || msg.includes("Check if this post is accessible")) {
    return "TIKTOK_BLOCKED: Vídeo indisponível. Tente atualizar yt-dlp (pip install -U yt-dlp) ou adicione cookies em config.js > socialDownload.cookies.tiktok";
  }
  if (msg.includes("Sign in to confirm")) {
    return "LOGIN_REQUIRED: Conteúdo restrito. Configure cookies da plataforma no config.js";
  }
  if (msg.includes("Unsupported URL")) {
    return "URL não suportada ou inválida.";
  }
  if (msg.includes("Requested format is not available")) {
    return "Formato de vídeo não disponível. Tente outro vídeo.";
  }
  if (msg.includes("HTTP Error 403") || msg.includes("403 Forbidden")) {
    return "ACESSO_NEGADO: O servidor recusou a conexão. Verifique cookies ou tente outro link.";
  }
  return `Erro do yt-dlp: ${msg.slice(0, 300)}`;
}

async function getInfo(url) {
  logYtDlpVersion();
  const bin = getYtDlpPath();
  const platform = getProviderFromUrl(url);
  const platformArgs = getPlatformArgs(platform);

  console.log(`[SocialDownloader] getInfo: ${url}`);
  console.log(`[SocialDownloader] platformArgs: ${platformArgs.join(" ")}`);

  try {
    const { stdout, stderr } = await runFile(bin, [
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      ...platformArgs,
      url,
    ]);
    if (stderr) console.log(`[SocialDownloader] yt-dlp stderr: ${stderr}`);
    return JSON.parse(stdout);
  } catch (err) {
    const stderr = err.stderr || err.message || "";
    console.error(`[SocialDownloader] getInfo error: ${stderr}`);
    throw new Error(mapYtDlpError(stderr, platform));
  }
}

function getProviderFromUrl(url = "") {
  if (!isValidHttpUrl(url)) return "";
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "tiktok.com" || host.endsWith(".tiktok.com") || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return "tiktok";
  }
  if (host === "open.spotify.com" || host === "spotify.com" || host.endsWith(".spotify.com")) {
    return "spotify";
  }
  return "";
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeText(text = "") {
  return String(text || "").trim();
}

function parseSocialDownloadCommand(text = "") {
  const raw = normalizeText(text);
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = String(parts[0] || "").toLowerCase();

  let provider = "";
  if (command === config.commands.tiktokDownload) provider = "tiktok";
  if (command === config.commands.spotifyDownload) provider = "spotify";
  if (!provider) return null;

  if (parts.length < 2) return { type: "invalid", provider, mode: "video", url: "" };

  let mode = "video";
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

function validateInfo(info) {
  const duration = Number(info?.duration || 0);
  if (duration && duration > config.socialDownload.maxDurationSec) {
    return { ok: false, reason: "duration", duration };
  }
  return { ok: true, duration };
}

async function downloadSocialMedia(command) {
  const info = await getInfo(command.url);
  const validation = validateInfo(info);
  if (!validation.ok) return validation;

  const id = crypto.randomUUID();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `social-download-${id}-`));
  const outputPattern = path.join(tempDir, "media.%(ext)s");
  const title = String(info?.title || command.provider).slice(0, 80);

  try {
    const downloadedPath = command.mode === "audio"
      ? await downloadAudio(command.url, outputPattern, tempDir, command.provider)
      : await downloadVideo(command.url, outputPattern, tempDir, command.provider);

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
  } catch (err) {
    const msg = err.message || "";
    if (msg.startsWith("TIKTOK_BLOCKED:") || msg.startsWith("LOGIN_REQUIRED:") || msg.startsWith("ACESSO_NEGADO:")) {
      throw err;
    }
    console.error(`[SocialDownloader] Falha inesperada: ${err.message}`);
    return { ok: false, reason: "download_failed", message: msg };
  } finally {
    safeRm(tempDir);
  }
}

async function downloadVideo(url, outputPattern, tempDir, provider) {
  const isTikTok = provider === "tiktok";
  const format = isTikTok
    ? "b[ext=mp4]/bv*+ba/b"
    : "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]/best";

  const platformArgs = getPlatformArgs(provider);
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--max-filesize", `${config.socialDownload.maxDownloadMB}M`,
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", outputPattern,
    ...platformArgs,
    url,
  ];

  console.log(`[SocialDownloader] downloadVideo: ${url}`);
  console.log(`[SocialDownloader] yt-dlp args: ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await runFile(YT_DLP_BIN, args);
    if (stderr) console.log(`[SocialDownloader] yt-dlp stderr: ${stderr}`);
  } catch (err) {
    const stderr = err.stderr || err.message || "";
    console.error(`[SocialDownloader] downloadVideo error: ${stderr}`);
    throw new Error(mapYtDlpError(stderr, provider));
  }
  return findNewestFile(tempDir);
}

async function downloadAudio(url, outputPattern, tempDir, provider) {
  const platformArgs = getPlatformArgs(provider);
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--max-filesize", `${config.socialDownload.maxDownloadMB}M`,
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "-o", outputPattern,
    ...platformArgs,
    url,
  ];

  console.log(`[SocialDownloader] downloadAudio: ${url}`);
  console.log(`[SocialDownloader] yt-dlp args: ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await runFile(YT_DLP_BIN, args);
    if (stderr) console.log(`[SocialDownloader] yt-dlp stderr: ${stderr}`);
  } catch (err) {
    const stderr = err.stderr || err.message || "";
    console.error(`[SocialDownloader] downloadAudio error: ${stderr}`);
    throw new Error(mapYtDlpError(stderr, provider));
  }
  return findNewestFile(tempDir);
}

async function prepareVideo(inputPath, tempDir) {
  const maxBytes = bytesFromMB(config.socialDownload.maxSendVideoMB);
  if (fs.statSync(inputPath).size <= maxBytes && path.extname(inputPath).toLowerCase() === ".mp4") {
    return { path: inputPath, mimetype: "video/mp4", ext: "mp4" };
  }

  const outputPath = path.join(tempDir, "compressed.mp4");
  const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
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
  const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
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

const YT_DLP_BIN = getYtDlpPath();

module.exports = {
  downloadSocialMedia,
  getProviderFromUrl,
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
    getYtDlpPath,
    findCookiesFile,
    getPlatformArgs,
    logYtDlpVersion,
  },
};