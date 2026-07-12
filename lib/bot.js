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
const { imageToSticker, stickerToImage, videoToSticker } = require("./stickerConverter");
const { log, logError } = require("./logger");
const { clearSession, ensureSessionDir, sessionExists } = require("./session");
const rank = require("./rank");

const logger = pino({ level: "silent" });
const seenMessages = new Set();
const botSentMessages = new Set();
const recentMediaByChat = new Map();
const recentMediaTtlMs = 5 * 60 * 1000;
let conversionQueue = Promise.resolve();

let currentQR = null;
let status = "waiting";
let sock = null;
let reconnectTimer = null;
let globalHandlersInstalled = false;
let starting = false;
let reconnectAttempts = 0;
let lastDisconnectInfo = null;

const MENU_TEXT = `╭━━━❰ 📖 STICKER BOT 📖 ❱━━━╮

  ✦ GERAL
  ┃ 📜 .menu
  ┃    ↳ exibe este menu

  ✦ FIGURINHAS
  ┃ 🖼️ .fig
  ┃    ↳ cria figurinha (img/vídeo/gif)
  ┃ 🖼️ .sticker
  ┃    ↳ atalho alternativo p/ .fig
  ┃ 👤 .figpp @usuário
  ┃    ↳ foto de perfil vira figurinha
  ┃ 🖼️ .toimg
  ┃    ↳ figurinha respondida vira imagem

  ✦ RANKING
  ┃ 🚀 .iniciarrank
  ┃    ↳ ativa o ranking no grupo
  ┃ 🏆 .rank
  ┃    ↳ ranking geral do grupo
  ┃ 📍 .rank me
  ┃ 📍 .meurank
  ┃    ↳ sua posição no grupo
  ┃ 🌎 .rank global
  ┃    ↳ ranking somado de todos os grupos
  ┃
  ┃ ⭐ Pontuação:
  ┃    texto +1 | figurinha +1
  ┃    imagem/vídeo/gif +2
  ┃    comandos não pontuam
  ┃    anti-spam: 5s

╰━━━━━━━━━━━━━━━━━━━━━━╯
                                 tomm bot`;

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

function getSticker(message = {}) {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped.stickerMessage) return null;

  return {
    type: "sticker",
    message: unwrapped,
    isAnimated: !!unwrapped.stickerMessage.isAnimated,
  };
}

function isStickerMessage(message = {}) {
  return !!unwrapMessage(message).stickerMessage;
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

function getQuotedSticker(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  if (!quoted || !context.stanzaId) return null;

  const sticker = getSticker(quoted);
  if (!sticker) return null;

  return {
    sticker,
    msg: {
      key: {
        remoteJid: msg.key.remoteJid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: false,
      },
      message: sticker.message,
    },
  };
}

function shouldIgnoreMessage(msg) {
  if (!msg?.key?.remoteJid) return true;
  if (msg.key.remoteJid === "status@broadcast") return true;
  if (msg.key.remoteJid.endsWith("@newsletter")) return true;
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

function rememberBotSentMessage(result) {
  const id = result?.key?.id || result?.id;
  if (!id) return;

  botSentMessages.add(id);
  if (botSentMessages.size > 500) {
    const oldest = [...botSentMessages].slice(0, 250);
    oldest.forEach((item) => botSentMessages.delete(item));
  }
}

function isBotSentMessage(msg) {
  return !!msg?.key?.id && botSentMessages.has(msg.key.id);
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

function messageSummary(msg) {
  const text = getText(msg.message);
  const media = getMedia(msg.message);
  const fromMe = msg.key?.fromMe ? "fromMe" : "fromUser";
  const mediaText = media ? mediaLabel(media) : "sem mídia";
  const textPreview = text ? ` texto="${text.slice(0, 40)}"` : "";
  return `${fromMe} ${mediaText}${textPreview}`;
}

function normalizeUserJid(jid = "") {
  return rank.normalizeParticipantId(jid);
}

function getSelfParticipantId() {
  return normalizeUserJid(sock?.user?.id || sock?.user?.jid || "");
}

function getRankParticipantId(msg) {
  if (msg.key?.fromMe && rank.isGroupJid(msg.key?.remoteJid)) {
    return getSelfParticipantId() || rank.getParticipantId(msg);
  }

  return rank.getParticipantId(msg);
}

function getRankDisplayName(msg, participantId) {
  if (msg.key?.fromMe) {
    return (
      rank.sanitizeDisplayName(msg.pushName) ||
      rank.sanitizeDisplayName(sock?.user?.name) ||
      rank.sanitizeDisplayName(sock?.user?.verifiedName) ||
      rank.getDisplayName(msg, participantId)
    );
  }

  return rank.getDisplayName(msg, participantId);
}

function getCommandName(text = "") {
  return normalizeText(text).split(/\s+/)[0] || "";
}

function isProfileStickerCommand(text = "") {
  return getCommandName(text) === config.commands.profileSticker;
}

function isStatusBotCommand(text = "") {
  return normalizeText(text) === config.commands.statusBot;
}

function isToImageCommand(text = "") {
  return normalizeText(text) === config.commands.toImage;
}

function enqueueSticker(chatId, sourceMsg, media) {
  conversionQueue = conversionQueue
    .catch(() => {})
    .then(() => sendSticker(chatId, sourceMsg, media));

  return conversionQueue;
}

async function downloadMedia(msg) {
  return downloadMediaMessage(msg, "buffer", {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  });
}

async function sendText(chatId, text) {
  rememberBotSentMessage(await sock.sendMessage(chatId, { text }));
}

async function sendImage(chatId, image, options = {}) {
  rememberBotSentMessage(await sock.sendMessage(chatId, {
    image,
    mimetype: options.mimetype || "image/png",
    caption: options.caption,
  }));
}

async function handleRankCommand(chatId, msg, text) {
  const command = rank.parseRankCommand(text);
  if (!command) return false;
  if (command.type === "invalid") return true;

  if (command.type === "remove") {
    if (!msg.key?.fromMe) return true;
    if (!command.query) {
      await sendText(chatId, 'Use assim: ".removerank nome" ou ".removerank 01"');
      return true;
    }

    const result = rank.removeUserGlobally(command.query);
    if (!result.removed.length) {
      await sendText(chatId, `Não encontrei "${command.query}" no ranking global.`);
      return true;
    }

    const names = [...new Set(result.removed.map(rank.getSafeDisplayName))].join(", ");
    await sendText(chatId, `🧹 Removido do ranking global: ${names}`);
    return true;
  }

  if (!rank.isGroupJid(chatId)) {
    if (command.type !== "reset") return true;
  }

  if (command.type === "reset") {
    if (!msg.key?.fromMe) return true;
    if (command.scope === "global") {
      rank.resetGlobalRank();
      await sendText(chatId, "🧹 Ranking global zerado. Os grupos continuam ativados e começam a pontuar do zero.");
      return true;
    }

    if (rank.isGroupJid(chatId)) {
      rank.resetGroupRank(chatId);
      await sendText(chatId, "🧹 Ranking deste grupo zerado. Os outros grupos não foram alterados.");
    }
    return true;
  }

  if (command.type === "help") {
    await sendText(chatId, rank.formatRankHelp());
    return true;
  }

  if (command.type === "start") {
    const wasEnabled = rank.isRankEnabled(chatId);
    rank.startRank(chatId);
    if (!wasEnabled) {
      await sendText(chatId, "🏆 Ranking ativado neste grupo! A partir de agora as mensagens começam a pontuar.");
    }
    return true;
  }

  if (!rank.isRankEnabled(chatId)) {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return true;
  }

  if (command.type === "global") {
    await sendText(chatId, rank.formatRankList(rank.rankGlobal(), "🌎 *Ranking global*"));
    return true;
  }

  const participantId = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, participantId);

  if (command.type === "me") {
    await sendText(chatId, rank.formatMyRank(rank.getUserPosition(chatId, participantId), displayName));
    return true;
  }

  await sendText(chatId, rank.formatRankList(rank.rankGroup(chatId), "🏆 *Ranking do grupo*"));
  return true;
}

async function handleUtilityCommand(chatId, msg, text) {
  if (isStatusBotCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, formatStatusBot());
    return true;
  }

  if (isProfileStickerCommand(text)) {
    await handleProfileStickerCommand(chatId, msg);
    return true;
  }

  if (isToImageCommand(text)) {
    await handleStickerToImageCommand(chatId, msg);
    return true;
  }

  return false;
}

async function handleProfileStickerCommand(chatId, msg) {
  const targetJid = getTargetJidFromMessage(msg);
  if (!targetJid) {
    await sendText(chatId, 'Marque alguém ou responda uma mensagem com ".figpp".');
    return;
  }

  try {
    const image = await downloadProfilePicture(targetJid);
    const sticker = await imageToSticker(image);
    rememberBotSentMessage(await sock.sendMessage(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    }));
  } catch (err) {
    logError(`Falha ao criar figurinha de perfil: ${err.message}`);
    await sendText(chatId, "Não consegui pegar a foto de perfil dessa pessoa.");
  }
}

async function handleStickerToImageCommand(chatId, msg) {
  const quoted = getQuotedSticker(msg);
  if (!quoted) {
    await sendText(chatId, 'Responda uma figurinha com ".toimg".');
    return;
  }

  try {
    const input = await downloadMedia(quoted.msg);
    const image = await stickerToImage(input);
    await sendImage(chatId, image);
  } catch (err) {
    logError(`Falha ao converter figurinha em imagem: ${err.message}`);
    await sendText(chatId, "Não consegui transformar essa figurinha em imagem.");
  }
}

async function downloadProfilePicture(jid) {
  const url = await sock.profilePictureUrl(jid, "image");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function getTargetJidFromMessage(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo || {};
  const mentioned = context.mentionedJid?.find(Boolean);
  if (mentioned) return normalizeUserJid(mentioned);
  if (context.participant) return normalizeUserJid(context.participant);
  return null;
}

function formatStatusBot() {
  const memory = process.memoryUsage();
  const rankSummary = rank.getStatsSummary();
  const uptime = formatDuration(process.uptime() * 1000);

  return [
    "🤖 *Status do bot*",
    "",
    `✅ Estado: ${status}`,
    `⏱️ Ligado há: ${uptime}`,
    `🧠 Memória: ${formatBytes(memory.rss)}`,
    `🏆 Grupos com rank ativo: ${rankSummary.activeGroups}`,
    `👥 Usuários no rank: ${rankSummary.rankedUsers}`,
    `🔁 Reconexões: ${reconnectAttempts}`,
  ].join("\n");
}

function formatBytes(value) {
  const mb = Number(value || 0) / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

function trackRankActivity(chatId, msg, text, media) {
  if (!rank.isGroupJid(chatId)) return;

  const participantId = getRankParticipantId(msg);
  const points = rank.getMessageScore({
    text,
    media,
    isSticker: isStickerMessage(msg.message),
  });

  rank.addActivity({
    groupId: chatId,
    participantId,
    displayName: getRankDisplayName(msg, participantId),
    points,
  });
}

async function sendSticker(chatId, sourceMsg, media) {
  try {
    await sock.sendMessage(chatId, { react: { text: "⏳", key: sourceMsg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    log(`Convertendo ${mediaLabel(media)} de ${chatId}`);

    const input = await downloadMedia(sourceMsg);
    const sticker = media.isImage
      ? await imageToSticker(input)
      : await videoToSticker(input);

    rememberBotSentMessage(await sock.sendMessage(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    }));

    await sock.sendMessage(chatId, { react: { text: "✅", key: sourceMsg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    log(`Figurinha enviada para ${chatId}`);
  } catch (err) {
    logError(`Falha ao criar figurinha: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: sourceMsg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    await sendText(chatId, "Não consegui criar essa figurinha. Tente outra mídia ou um vídeo mais curto.");
  }
}

async function processMessage(msg) {
  if (shouldIgnoreMessage(msg)) return;
  if (isBotSentMessage(msg)) return;
  if (isDuplicate(msg.key.id)) return;

  const chatId = msg.key.remoteJid;
  const text = getText(msg.message);
  const media = getMedia(msg.message);
  log(`Mensagem recebida de ${chatId}: ${messageSummary(msg)}`);

  if (isMenuCommand(text)) {
    await sendText(chatId, MENU_TEXT);
    return;
  }

  if (await handleUtilityCommand(chatId, msg, text)) {
    return;
  }

  if (await handleRankCommand(chatId, msg, text)) {
    return;
  }

  trackRankActivity(chatId, msg, text, media);

  if (media && isStickerCommand(media.caption)) {
    await enqueueSticker(chatId, msg, media);
    return;
  }

  if (media) {
    rememberMedia(chatId, msg, media);
    return;
  }

  if (!isStickerCommand(text)) return;

  const quoted = getQuotedMedia(msg);
  if (quoted) {
    await enqueueSticker(chatId, quoted.msg, quoted.media);
    return;
  }

  const recent = getRecentMedia(chatId);
  if (recent) {
    await enqueueSticker(chatId, recent.msg, recent.media);
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
    getQuotedSticker,
    getRecentMedia,
    getSticker,
    getTargetJidFromMessage,
    getText,
    handleRankCommand,
    handleUtilityCommand,
    isDuplicate,
    isMenuCommand,
    isBotSentMessage,
    isProfileStickerCommand,
    isStickerMessage,
    isStickerCommand,
    isStatusBotCommand,
    isToImageCommand,
    MENU_TEXT,
    formatBytes,
    formatDuration,
    formatStatusBot,
    normalizeText,
    normalizeUserJid,
    rememberBotSentMessage,
    rememberMedia,
    shouldIgnoreMessage,
    trackRankActivity,
    unwrapMessage,
  },
};
