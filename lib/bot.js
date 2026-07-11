const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const config = require("../config");
const { imageToSticker, videoToSticker } = require("./stickerConverter");
const { log, logError } = require("./logger");
const { clearSession, ensureSessionDir, sessionExists } = require("./session");

const logger = pino({ level: "silent" });
const seenMessages = new Set();
const recentMediaByChat = new Map();
const recentMediaTtlMs = 5 * 60 * 1000;

let currentQR = null;
let status = "waiting";
let sock = null;
let reconnectTimer = null;
let globalHandlersInstalled = false;
let starting = false;
let reconnectAttempts = 0;
let lastDisconnectInfo = null;

const MENU_TEXT = `╭─❍ *Sticker Bot* ❍─╮

📌 *COMANDOS*

.menu
  → mostra este menu

.fig
  → cria figurinha da imagem, vídeo ou GIF

.sticker
  → mesmo comando alternativo

╰─❍────────────❍─╯`;

function getState() {
  return {
    currentQR,
    status,
    hasSession: sessionExists(),
    lastDisconnect: lastDisconnectInfo,
    reconnectAttempts,
  };
}

function normalizeText(text = "") {
  return String(text).trim().toLowerCase();
}

function isStickerCommand(text) {
  return config.commands.sticker.includes(normalizeText(text));
}

function isMenuCommand(text) {
  return normalizeText(text) === config.commands.menu;
}

function unwrapMessage(message = {}) {
  if (!message) return {};

  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function getText(message = {}) {
  const unwrapped = unwrapMessage(message);
  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    ""
  );
}

function getMedia(message = {}) {
  const unwrapped = unwrapMessage(message);

  if (unwrapped.imageMessage) {
    return { type: "image", isImage: true, message: unwrapped, caption: unwrapped.imageMessage.caption || "" };
  }

  if (unwrapped.videoMessage) {
    return { type: "video", isImage: false, message: unwrapped, caption: unwrapped.videoMessage.caption || "" };
  }

  return null;
}

function getQuotedMedia(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  if (!quoted || !context.stanzaId) return null;

  const media = getMedia(quoted);
  if (!media) return null;

  return {
    media,
    msg: {
      key: {
        remoteJid: msg.key.remoteJid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: false,
      },
      message: media.message,
    },
  };
}

function shouldIgnoreMessage(msg) {
  if (!msg?.key?.remoteJid) return true;
  if (msg.key.remoteJid === "status@broadcast") return true;
  if (msg.key.fromMe && !config.bot.allowSelfMessages) return true;
  return false;
}

function isDuplicate(id) {
  if (!id) return false;
  if (seenMessages.has(id)) return true;

  seenMessages.add(id);
  if (seenMessages.size > 500) {
    const oldest = [...seenMessages].slice(0, 250);
    oldest.forEach((item) => seenMessages.delete(item));
  }

  return false;
}

function rememberMedia(chatId, msg, media, now = Date.now()) {
  if (!chatId || !media) return;
  recentMediaByChat.set(chatId, { msg, media, createdAt: now });
}

function getRecentMedia(chatId, now = Date.now()) {
  const item = recentMediaByChat.get(chatId);
  if (!item) return null;

  if (now - item.createdAt > recentMediaTtlMs) {
    recentMediaByChat.delete(chatId);
    return null;
  }

  return item;
}

function mediaLabel(media) {
  return media?.type === "video" ? "vídeo/GIF" : "imagem";
}

async function downloadMedia(msg) {
  return downloadMediaMessage(msg, "buffer", {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  });
}

async function sendText(chatId, text) {
  await sock.sendMessage(chatId, { text });
}

async function sendSticker(chatId, sourceMsg, media) {
  try {
    await sock.sendMessage(chatId, { react: { text: "⏳", key: sourceMsg.key } }).catch(() => {});
    log(`Convertendo ${mediaLabel(media)} de ${chatId}`);

    const input = await downloadMedia(sourceMsg);
    const sticker = media.isImage
      ? await imageToSticker(input)
      : await videoToSticker(input);

    await sock.sendMessage(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    });

    await sock.sendMessage(chatId, { react: { text: "✅", key: sourceMsg.key } }).catch(() => {});
    log(`Figurinha enviada para ${chatId}`);
  } catch (err) {
    logError(`Falha ao criar figurinha: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: sourceMsg.key } }).catch(() => {});
    await sendText(chatId, "Não consegui criar essa figurinha. Tente outra mídia ou um vídeo mais curto.");
  }
}

async function processMessage(msg) {
  if (shouldIgnoreMessage(msg)) return;
  if (isDuplicate(msg.key.id)) return;

  const chatId = msg.key.remoteJid;
  const text = getText(msg.message);
  const media = getMedia(msg.message);

  if (isMenuCommand(text)) {
    await sendText(chatId, MENU_TEXT);
    return;
  }

  if (media && isStickerCommand(media.caption)) {
    await sendSticker(chatId, msg, media);
    return;
  }

  if (media) {
    rememberMedia(chatId, msg, media);
    return;
  }

  if (!isStickerCommand(text)) return;

  const quoted = getQuotedMedia(msg);
  if (quoted) {
    await sendSticker(chatId, quoted.msg, quoted.media);
    return;
  }

  const recent = getRecentMedia(chatId);
  if (recent) {
    await sendSticker(chatId, recent.msg, recent.media);
    return;
  }

  await sendText(chatId, 'Mande uma imagem/vídeo com legenda ".fig", responda uma mídia com ".fig", ou envie a mídia e depois ".fig".');
}

function installGlobalHandlers() {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  process.on("uncaughtException", (err) => {
    if (String(err?.message || err).includes("Bad MAC")) return;
    logError(`Erro inesperado: ${err.message}`);
  });

  process.on("unhandledRejection", (err) => {
    if (String(err).includes("Bad MAC")) return;
    logError(`Rejeição não tratada: ${err}`);
  });
}

function assertFfmpeg() {
  const { execFileSync } = require("child_process");
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    log("ffmpeg detectado.");
  } catch {
    throw new Error("ffmpeg/ffprobe não encontrado. Instale com: winget install FFmpeg");
  }
}

async function startBot() {
  assertFfmpeg();
  await startConnection();
}

function cleanupSocket() {
  if (!sock) return;

  try {
    sock.ev.removeAllListeners("creds.update");
    sock.ev.removeAllListeners("messages.upsert");
    sock.ev.removeAllListeners("connection.update");
  } catch {}

  try {
    sock.end?.();
  } catch {}

  sock = null;
}

function getReconnectDelay() {
  const min = config.bot.reconnectMinMs;
  const max = config.bot.reconnectMaxMs;
  return Math.min(max, min * Math.max(1, reconnectAttempts));
}

function scheduleReconnect(reason = "desconhecido") {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = getReconnectDelay();
  status = "reconnecting";
  lastDisconnectInfo = reason;
  log(`Reconectando em ${Math.round(delay / 1000)}s (${reason})...`);

  reconnectTimer = setTimeout(() => {
    startConnection().catch((err) => {
      logError(`Reconexão falhou: ${err.message}`);
      scheduleReconnect(err.message);
    });
  }, delay);
}

async function startConnection() {
  if (starting) return;
  starting = true;

  try {
    cleanupSocket();
    assertFfmpeg();
    ensureSessionDir();

    const { state, saveCreds } = await useMultiFileAuthState(config.paths.authInfo);
    const { version } = await fetchLatestBaileysVersion();
    log(`WhatsApp Web v${version.join(".")}`);

    sock = makeWASocket({
      version,
      logger,
      emitOwnEvents: config.bot.allowSelfMessages,
      markOnlineOnConnect: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: config.bot.browser,
    });

    registerSocketHandlers(saveCreds);
  } finally {
    starting = false;
  }
}

function registerSocketHandlers(saveCreds) {
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      processMessage(msg).catch((err) => logError(`Erro na mensagem: ${err.message}`));
    }
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect: disconnect, qr }) => {
    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      currentQR = dataUrl.split(",")[1];
      status = "waiting";
      log("QR Code gerado. Abra o navegador e escaneie.");
    }

    if (connection === "open") {
      currentQR = null;
      status = "connected";
      reconnectAttempts = 0;
      lastDisconnectInfo = null;
      log("Bot conectado. Pode testar com .menu ou .fig.");
    }

    if (connection === "close") {
      currentQR = null;
      const code = disconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[code] || disconnect?.error?.message || `code_${code || "unknown"}`;
      cleanupSocket();

      if (code === DisconnectReason.loggedOut) {
        status = "logged_out";
        lastDisconnectInfo = reason;
        clearSession();
        logError("Sessão inválida/desconectada. Sessão local apagada; gerando QR novo em seguida.");
        scheduleReconnect("logged_out");
        return;
      }

      scheduleReconnect(reason);
    }
  });
}

installGlobalHandlers();

module.exports = {
  getState,
  startBot,
  _private: {
    getMedia,
    getQuotedMedia,
    getRecentMedia,
    getText,
    isDuplicate,
    isMenuCommand,
    isStickerCommand,
    MENU_TEXT,
    normalizeText,
    rememberMedia,
    shouldIgnoreMessage,
    unwrapMessage,
  },
};
