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

// Estado do bot
let currentQR = null;
let status = "waiting";

function getState() {
  return { currentQR, status };
}

// Deduplicação — mantém últimos 100 IDs
const recentIds = [];
function isDuplicate(id) {
  if (recentIds.includes(id)) return true;
  recentIds.push(id);
  if (recentIds.length > 100) recentIds.shift();
  return false;
}

// Formata número para exibição
function formatNumber(jid) {
  return jid.replace(/@.*/, "").replace(/^55/, "");
}

// Texto do menu
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

// Processa uma mensagem recebida
async function processMessage(sock, msg) {
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

  // Verifica se é imagem ou vídeo (com legenda .fig)
  const isImage = !!m.imageMessage;
  const isVideo = !!m.videoMessage;
  const caption =
    m.imageMessage?.caption || m.videoMessage?.caption || "";
  const t = caption.trim().toLowerCase();
  const isSticker = t === config.commandPrefix || t === config.commandPrefixAlt;

  // Verifica se é resposta a uma imagem com .fig
  const isReply = !!m.extendedTextMessage?.contextInfo?.quotedMessage;
  const replyText = m.extendedTextMessage?.text || "";
  const replyIsSticker = replyText.trim().toLowerCase() === config.commandPrefix ||
    replyText.trim().toLowerCase() === config.commandPrefixAlt;

  // Caso 1: Imagem/gif com .fig na legenda
  if ((isImage || isVideo) && isSticker) {
    await createSticker(sock, msg, from, isImage, numero);
    return;
  }

  // Caso 2: Resposta a uma imagem/gif com .fig
  if (isReply && replyIsSticker) {
    const quotedMsg = m.extendedTextMessage.contextInfo.quotedMessage;
    const quotedIsImage = !!quotedMsg.imageMessage;
    const quotedIsVideo = !!quotedMsg.videoMessage;
    if (quotedIsImage || quotedIsVideo) {
      // Baixa a mídia da mensagem citada
      const quoted = {
        key: m.extendedTextMessage.contextInfo.participant
          ? { remoteJid: from, id: m.extendedTextMessage.contextInfo.stanzaId, fromMe: false }
          : { remoteJid: from, id: m.extendedTextMessage.contextInfo.stanzaId, fromMe: true },
        message: quotedMsg,
      };
      await createSticker(sock, quoted, from, quotedIsImage, numero);
      return;
    }
  }

  // Caso 3: Texto .fig sem mídia — envia instrução
  if (text.trim().toLowerCase() === config.commandPrefix ||
      text.trim().toLowerCase() === config.commandPrefixAlt) {
    await sock.sendMessage(from, {
      text: 'Envie uma imagem/gif com ".fig" na legenda, ou responda uma imagem com ".fig".',
    });
  }
}

// Cria e envia a figurinha
async function createSticker(sock, msg, from, isImage, numero) {
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

// Inicia o bot
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

  // Garante que a pasta de sessão existe
  if (!fs.existsSync(config.paths.authInfo)) {
    fs.mkdirSync(config.paths.authInfo, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.paths.authInfo);
  const { version } = await fetchLatestBaileysVersion();
  log(`WhatsApp Web v${version.join(".")}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ["Sticker Bot", "Chrome", "1.0.0"],
  });

  // Salva credenciais
  sock.ev.on("creds.update", saveCreds);

  // Processa mensagens
  sock.ev.on("messages.upsert", async (u) => {
    for (const m of u.messages) await processMessage(sock, m);
  });

  // Conexão
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
      if (code !== DisconnectReason.loggedOut) {
        log("Reconectando...");
        currentQR = null;
        startBot();
      } else {
        try {
          fs.rmSync(config.paths.authInfo, { recursive: true, force: true });
        } catch {}
        logError("Sessão apagada. Reinicie o bot.");
        currentQR = null;
        status = "error";
      }
    }

    if (connection === "open") {
      currentQR = null;
      status = "connected";
      log("Bot conectado ao WhatsApp!");
    }
  });
}

module.exports = { startBot, getState };
