/**
 * lib/bot.js — Conexão com WhatsApp e processamento de mensagens
 */
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const config = require("../config");
const { imageToSticker, videoToSticker } = require("./stickerConverter");
const { log, logError } = require("./logger");

const logger = pino({ level: "silent" });

let currentQR = null;
let status = "waiting";
let sock = null;

function getState() {
  return { currentQR, status };
}

// Deduplicação
const recentIds = [];
function isDuplicate(id) {
  if (recentIds.includes(id)) return true;
  recentIds.push(id);
  if (recentIds.length > 100) recentIds.shift();
  return false;
}

function formatNumber(jid) {
  return jid.replace(/@.*/, "").replace(/^55/, "");
}

const MENU_TEXT = `╭─❍ *BotFig* ❍─╮

Olá! Eu crio figurinhas e gifs animados no WhatsApp.

📌 *COMANDOS*

.menu
  → mostra este menu

.fig (em imagem)
  → transforma a imagem em figurinha 512x512

.fig (em vídeo/gif)
  → transforma um vídeo curto ou gif em figurinha animada
  → duração máxima: 6 segundos

💡 *DICA*
Quanto mais quadrada a imagem, melhor fica a figurinha.

╰─❍───────❍─╯`;

async function processMessage(msg) {
  if (!msg) return;

  const id = msg.key.id;
  if (isDuplicate(id)) return;

  const from = msg.key.remoteJid;
  const m = msg.message;
  if (!m) return;

  const numero = formatNumber(from);

  // Comando .menu
  const text = m.conversation || m.extendedTextMessage?.text || "";
  if (text.trim().toLowerCase() === ".menu") {
    await sock.sendMessage(from, { text: MENU_TEXT });
    return;
  }

  // Verifica mídia com legenda .fig
  const isImage = !!m.imageMessage;
  const isVideo = !!m.videoMessage;
  const caption = m.imageMessage?.caption || m.videoMessage?.caption || "";
  const isSticker = caption.trim().toLowerCase() === config.commandPrefix ||
    caption.trim().toLowerCase() === config.commandPrefixAlt;

  // Verifica resposta a mídia com .fig
  const isReply = !!m.extendedTextMessage?.contextInfo?.quotedMessage;
  const replyText = m.extendedTextMessage?.text || "";
  const replyIsSticker = replyText.trim().toLowerCase() === config.commandPrefix ||
    replyText.trim().toLowerCase() === config.commandPrefixAlt;

  if ((isImage || isVideo) && isSticker) {
    await createSticker(msg, from, isImage, numero);
    return;
  }

  if (isReply && replyIsSticker) {
    const quotedMsg = m.extendedTextMessage.contextInfo.quotedMessage;
    const quotedIsImage = !!quotedMsg.imageMessage;
    const quotedIsVideo = !!quotedMsg.videoMessage;
    if (quotedIsImage || quotedIsVideo) {
      const quoted = {
        key: {
          remoteJid: from,
          id: m.extendedTextMessage.contextInfo.stanzaId,
          fromMe: m.extendedTextMessage.contextInfo.participant ? false : true,
        },
        message: quotedMsg,
      };
      await createSticker(quoted, from, quotedIsImage, numero);
      return;
    }
  }

  if (text.trim().toLowerCase() === config.commandPrefix ||
      text.trim().toLowerCase() === config.commandPrefixAlt) {
    await sock.sendMessage(from, {
      text: 'Envie uma imagem/gif com ".fig" na legenda, ou responda uma imagem com ".fig".',
    });
  }
}

async function createSticker(msg, from, isImage, numero) {
  try {
    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

    const buf = await downloadMediaMessage(msg, "buffer", {});
    const sticker = isImage
      ? await imageToSticker(buf)
      : await videoToSticker(buf);

    await sock.sendMessage(from, {
      sticker,
      mimetype: "image/webp",
      packname: "Criado por Thomaz",
      author: "bot do t00m4ziow",
    });

    log(`Figurinha criada para +55${numero}`);
  } catch (err) {
    logError(`Figurinha falhou: ${err.message}`);
  }
}

// ─── Inicia o bot ──────────────────────────────────────────────────
async function startBot() {
  // Verifica ffmpeg
  const { execSync } = require("child_process");
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    execSync("ffprobe -version", { stdio: "ignore" });
    log("ffmpeg detectado.");
  } catch {
    logError("Instale o ffmpeg: winget install FFmpeg");
    process.exit(1);
  }

  if (!fs.existsSync(config.paths.authInfo)) {
    fs.mkdirSync(config.paths.authInfo, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.paths.authInfo);
  const { version } = await fetchLatestBaileysVersion();
  log(`WhatsApp Web v${version.join(".")}`);

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ["Sticker Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (u) => {
    for (const m of u.messages) {
      await processMessage(m).catch(() => {});
    }
  });

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      currentQR = dataUrl.split(",")[1];
      status = "waiting";
      log("Escaneie o QR Code no navegador.");
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        try { fs.rmSync(config.paths.authInfo, { recursive: true, force: true }); } catch {}
        logError("Sessão apagada. Reinicie o bot.");
        currentQR = null;
        status = "error";
      } else {
        log("Reconectando em 3s...");
        currentQR = null;
        status = "waiting";
        setTimeout(() => startBot(), 3000);
      }
    }

    if (connection === "open") {
      currentQR = null;
      status = "connected";
      log("Bot conectado ao WhatsApp!");
    }
  });
}

// ─── Tratamento global de erros ────────────────────────────────────
process.on("uncaughtException", (err) => {
  // Ignora erros de criptografia
  if (err.message?.includes("Bad MAC") || err.message?.includes("Session")) return;
  logError(`Erro inesperado: ${err.message}`);
});

process.on("unhandledRejection", (err) => {
  if (String(err).includes("Bad MAC") || String(err).includes("Session")) return;
  logError(`Rejeição não tratada: ${err}`);
});

module.exports = { startBot, getState };
