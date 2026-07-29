const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const QRCode = require("qrcode");
const config = require("../config");
const { convertAudio, getAudioEffectByCommand } = require("./audioConverter");
const { imageToSticker, replaceStickerMetadata, rgbTextToSticker, stickerToImage, textToSticker, videoToSticker } = require("./stickerConverter");
const { log, logError, readRecentLogs } = require("./logger");
const { clearSession, ensureSessionDir, sessionExists } = require("./session");
const rank = require("./rank");
const xboxDeals = require("./xboxDeals");
const nvidiaAi = require("./nvidiaAi");

const logger = pino({ level: "silent" });
const seenMessages = new Set();
const botSentMessages = new Set();
const recentMessagesByChat = new Map();
const recentMediaByChat = new Map();
const recentAudioByChat = new Map();
const recentMediaTtlMs = 5 * 60 * 1000;
const maxRecentMessagesPerChat = 80;
let conversionQueue = Promise.resolve();

let currentQR = null;
let status = "waiting";
let sock = null;
let reconnectTimer = null;
let globalHandlersInstalled = false;
let starting = false;
let reconnectAttempts = 0;
let lastDisconnectInfo = null;
let activeReplyMessage = null;
let maintenanceMode = false;
let maintenanceSilentMode = false;
let aiEnabled = true;
let aiSilentDisabled = false;

const MENU_PAGES = [
`╭─❰ 📖 MENU ❱─╮

  ✦ GERAL
  ┃ 📜 .menu
  ┃    ↳ exibe este menu
  ┃ 👤 .perfil
  ┃    ↳ mostra pontos, level, tag e tema
  ┃ 🤖 .ia <texto>
  ┃    ↳ conversa com IA

╰━━━━━━━━━━━━╯`,
`╭─❰ 🖼️ FIGS ❱─╮

  ✦ FIGS
  ┃ 🖼️ .fig
  ┃    ↳ cria figurinha (img/vídeo/gif)
  ┃ 🖼️ .sticker
  ┃    ↳ atalho alternativo p/ .fig
  ┃ ✂️ .figcrop
  ┃    ↳ recorta imagem em 1:1
  ┃ 🏷️ .roubar
  ┃    ↳ troca os dados de uma figurinha respondida
  ┃ 📌 .figpin <link...>
  ┃    ↳ cria figurinha(s) do Pinterest
  ┃ 👤 .figpp @usuário
  ┃    ↳ foto de perfil vira figurinha
  ┃ 🔤 .figtxt <texto>
  ┃    ↳ cria figurinha de texto
  ┃ 🌈 .figtxt rgb <texto>
  ┃    ↳ cria texto colorido animado
  ┃ 🖼️ .toimg
  ┃    ↳ figurinha respondida vira imagem

╰━━━━━━━━━━━━╯`,
`╭─❰ 🎙️ ÁUDIO ❱─╮

  ✦ ÁUDIO
  ┃ 🎙️ .vozgrave
  ┃    ↳ deixa o áudio com voz grave
  ┃ 🎙️ .vozfina
  ┃    ↳ deixa o áudio com voz fina
  ┃ ⚡ .veloz
  ┃    ↳ acelera o áudio
  ┃ 🐢 .lento
  ┃    ↳ deixa o áudio lento

  ✦ DIVERSÃO
  ┃ 🎲 .sorteio
  ┃    ↳ sorteia alguém do grupo
  ┃ 🎁 .presente @user <pts>
  ┃    ↳ envia pontos para alguém
  ┃ 💍 .casamento
  ┃    ↳ explica casamento e bônus
  ┃ 🎮 .xboxpromo
  ┃    ↳ jogos Xbox em promoção

╰━━━━━━━━━━━━╯`,
`╭─❰ 🏆 RANK ❱─╮

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

╰━━━━━━━━━━━━╯`,
`╭─❰ ⭐ LEVEL ❱─╮

  ✦ LEVEL
  ┃ 🎁 .daily
  ┃    ↳ resgata pontos diários
  ┃ 🎰 .roleta
  ┃    ↳ gira 1x por dia e ganha pontos
  ┃ ⭐ .level
  ┃    ↳ mostra seu nível e XP
  ┃ ⭐ .toplevel
  ┃    ↳ ranking de níveis do grupo
  ┃ 🏅 .conquistas
  ┃    ↳ mostra suas medalhas
  ┃
  ┃ Como pegar conquistas:
  ┃    suba level, mande mensagens,
  ┃    figurinhas/mídias, fique top 1,
  ┃    compre tags/temas e use o daily

╰━━━━━━━━━━━━╯`,
`╭─❰ 🛒 LOJA ❱─╮

  ✦ LOJA
  ┃ 🛒 .loja
  ┃    ↳ mostra tags e preços
  ┃ 🛍️ .comprar <tag>
  ┃    ↳ compra uma tag com pontos
  ┃ 🏷️ .usartag <tag>
  ┃    ↳ equipa uma tag no rank
  ┃ 🎒 .minhastags
  ┃    ↳ mostra suas tags
  ┃ 🚫 .removertag
  ┃    ↳ remove tag equipada
  ┃ 🎨 .perfil temas
  ┃    ↳ loja de temas do perfil

╰━━━━━━━━━━━━╯`,
];

const MENU_TEXT = MENU_PAGES.join("\n\n");

const DEV_MENU_TEXT = `╭─❰ 🛠️ DEV CENTER ❱─╮

  ✦ SISTEMA
  ┃ 🛠️ .menudev
  ┃    ↳ mostra estes comandos
  ┃ 🤖 .statusbo
  ┃    ↳ status, memória e uptime
  ┃ 📋 .erros
  ┃    ↳ últimos erros/logs
  ┃ 📴 .manutencao on/off/status
  ┃    ↳ manutenção global
  ┃ 📴 .manutencao on nologs
  ┃    ↳ manutenção sem aviso
  ┃ 🤖 .iaon
  ┃    ↳ ativa o comando .ia
  ┃ 🤖 .iaoff
  ┃    ↳ desativa .ia com aviso
  ┃ 🤖 .iaoff nologs
  ┃    ↳ desativa .ia em silêncio
  ┃ 🔄 .reiniciar
  ┃    ↳ reinicia pelo PM2

╰━━━━━━━━━━━━╯

╭─❰ 🏆 DEV RANK ❱─╮

  ✦ RANKING
  ┃ 🧹 .zerarrank
  ┃    ↳ zera só o grupo atual
  ┃ 🧹 .zerarrank global
  ┃    ↳ zera todos os grupos
  ┃ 🗑️ .removerank <nome/id>
  ┃    ↳ remove usuário global
  ┃ 🎰 .roletadev
  ┃    ↳ roleta sem cooldown
  ┃ ⭐ .devlevel dar @user <xp>
  ┃    ↳ adiciona XP/pontos
  ┃ ⭐ .devlevel tirar @user <xp>
  ┃    ↳ remove XP/pontos
  ┃ ⭐ .devlevel setar @user <xp>
  ┃    ↳ define XP no grupo
  ┃ ⭐ .devlevel resetar @user
  ┃    ↳ zera XP do usuário
  ┃ ⭐ .devlevel resetgrupo
  ┃    ↳ zera XP do grupo

╰━━━━━━━━━━━━╯

╭─❰ 🏷️ DEV LOJA ❱─╮

  ✦ TAGS
  ┃ 🏷️ .devtag dar @user <tag>
  ┃    ↳ dá uma tag
  ┃ 🏷️ .devtag tirar @user <tag/todas>
  ┃    ↳ remove tag
  ┃ 🏷️ .devtag usar @user <tag>
  ┃    ↳ equipa tag

  ✦ TEMAS
  ┃ 🎨 .devtema dar @user <tema>
  ┃    ↳ dá tema
  ┃ 🎨 .devtema tirar @user <tema/todos>
  ┃    ↳ remove tema
  ┃ 🎨 .devtema usar @user <tema>
  ┃    ↳ equipa tema

╰━━━━━━━━━━━━╯`;

function getState() {
  return {
    currentQR,
    status,
    hasSession: sessionExists(),
    lastDisconnect: lastDisconnectInfo,
    reconnectAttempts,
    maintenanceMode,
    maintenanceSilentMode,
    aiEnabled,
    aiSilentDisabled,
  };
}

function normalizeText(text = "") {
  return String(text).trim().toLowerCase();
}

function isStickerCommand(text) {
  return config.commands.sticker.includes(normalizeText(text));
}

function isStickerCropCommand(text) {
  return normalizeText(text) === config.commands.stickerCrop;
}

function isStealStickerCommand(text) {
  return normalizeText(text) === config.commands.stealSticker;
}

function parsePinterestStickerCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (normalizeText(parts[0]) !== config.commands.pinterestSticker) return null;
  const urls = parts.slice(1);
  if (!urls.length) return { type: "invalid", urls: [] };
  return {
    type: "pin",
    urls: urls.slice(0, config.bot.maxPinterestLinks),
    ignored: Math.max(0, urls.length - config.bot.maxPinterestLinks),
  };
}

function isAnyStickerCommand(text) {
  return isStickerCommand(text) || isStickerCropCommand(text);
}

function isMenuCommand(text) {
  return normalizeText(text) === config.commands.menu;
}

function isDevMenuCommand(text) {
  return normalizeText(text) === config.commands.devMenu;
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

function getAudio(message = {}) {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped.audioMessage) return null;

  return {
    type: "audio",
    message: unwrapped,
    isPtt: !!unwrapped.audioMessage.ptt,
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

function getQuotedAudio(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  if (!quoted || !context.stanzaId) return null;

  const audio = getAudio(quoted);
  if (!audio) return null;

  return {
    audio,
    msg: {
      key: {
        remoteJid: msg.key.remoteJid,
        id: context.stanzaId,
        participant: context.participant,
        fromMe: false,
      },
      message: audio.message,
    },
  };
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

function setSockForTests(nextSock) {
  sock = nextSock;
}

function normalizeMessageKey(key = {}) {
  if (!key.remoteJid || !key.id) return null;
  return {
    remoteJid: key.remoteJid,
    id: key.id,
    fromMe: !!key.fromMe,
    ...(key.participant ? { participant: key.participant } : {}),
  };
}

function rememberRecentMessage(msg) {
  const key = normalizeMessageKey(msg?.key);
  if (!key) return;

  const messages = recentMessagesByChat.get(key.remoteJid) || [];
  if (!messages.some((item) => item.id === key.id)) messages.push(key);
  while (messages.length > maxRecentMessagesPerChat) messages.shift();
  recentMessagesByChat.set(key.remoteJid, messages);
}

function getRecentMessageKeys(chatId, amount, excludedId = "") {
  const limit = Math.max(0, Math.min(30, Number(amount) || 0));
  if (!chatId || !limit) return [];

  const messages = recentMessagesByChat.get(chatId) || [];
  return messages
    .filter((key) => key.id !== excludedId)
    .slice(-limit)
    .reverse();
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

function rememberAudio(chatId, msg, audio, now = Date.now()) {
  if (!chatId || !audio) return;
  recentAudioByChat.set(chatId, { msg, audio, createdAt: now });
}

function getRecentAudio(chatId, now = Date.now()) {
  const item = recentAudioByChat.get(chatId);
  if (!item) return null;

  if (now - item.createdAt > recentMediaTtlMs) {
    recentAudioByChat.delete(chatId);
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

function isErrorsCommand(text = "") {
  return normalizeText(text) === config.commands.errors;
}

function parseMaintenanceCommand(text = "") {
  const parts = normalizeText(text).split(/\s+/).filter(Boolean);
  if (parts[0] !== config.commands.maintenance) return null;
  if (parts.length === 1) return { action: "status" };
  if (parts.length === 3 && parts[1] === "on" && parts[2] === "nologs") {
    return { action: "on", silent: true };
  }
  if (parts.length === 2 && ["on", "off", "status"].includes(parts[1])) {
    return { action: parts[1], silent: false };
  }
  return { action: "invalid" };
}

function isRestartCommand(text = "") {
  return normalizeText(text) === config.commands.restart;
}

function parseDeleteMessagesCommand(text = "") {
  const parts = normalizeText(text).split(/\s+/).filter(Boolean);
  if (parts[0] !== config.commands.deleteMessages) return null;
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) return { type: "invalid" };

  const amount = Number(parts[1]);
  if (amount < 1 || amount > 30) return { type: "invalid" };
  return { type: "delete", amount };
}

function isRaffleCommand(text = "") {
  return normalizeText(text) === config.commands.raffle;
}

function isDailyCommand(text = "") {
  return normalizeText(text) === config.commands.daily;
}

function getQuotedText(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  if (!quoted || !context.stanzaId) return "";

  return getText(quoted).slice(0, config.ai.maxPromptChars);
}

function buildAiPrompt(commandPrompt = "", msg = {}) {
  const quotedText = getQuotedText(msg);
  if (!quotedText) return commandPrompt;

  return [
    "Mensagem marcada:",
    quotedText,
    "",
    "Pedido do usuário:",
    commandPrompt,
  ].join("\n").slice(0, config.ai.maxPromptChars);
}

function isRouletteCommand(text = "") {
  return normalizeText(text) === config.commands.roulette;
}

function isRouletteDevCommand(text = "") {
  return normalizeText(text) === config.commands.rouletteDev;
}

function parseXboxDealsCommand(text = "") {
  return xboxDeals.parseXboxDealsCommand(text);
}

function parseAiCommand(text = "") {
  return nvidiaAi.parseAiCommand(text);
}

function parseAiControlCommand(text = "") {
  const parts = normalizeText(text).split(/\s+/).filter(Boolean);
  if (parts[0] === config.commands.aiOn) {
    if (parts.length !== 1) return { action: "invalid" };
    return { action: "on" };
  }
  if (parts[0] === config.commands.aiOff) {
    if (parts.length === 1) return { action: "off", silent: false };
    if (parts.length === 2 && parts[1] === "nologs") return { action: "off", silent: true };
    return { action: "invalid" };
  }
  return null;
}

function parseLevelCommand(text = "") {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  const command = normalizeText(parts[0]);
  if (command !== config.commands.level && command !== config.commands.achievements && command !== config.commands.topLevel) return null;
  if (command === config.commands.topLevel) {
    if (parts.length !== 1) return { type: "invalid", command: "topLevel" };
    return { type: "topLevel" };
  }
  return {
    type: command === config.commands.level ? "level" : "achievements",
    query: parts.slice(1).join(" ").trim(),
  };
}

function parseDevAssetCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = normalizeText(parts[0]);
  if (command !== ".devtag" && command !== ".devtema") return null;

  const action = normalizeText(parts[1]);
  if (!["dar", "tirar", "remover", "usar", "equipar"].includes(action)) {
    return { type: "invalid", asset: command === ".devtag" ? "tag" : "theme" };
  }

  return {
    type: action === "tirar" || action === "remover" ? "revoke" : action === "dar" ? "grant" : "equip",
    asset: command === ".devtag" ? "tag" : "theme",
    rawArgs: parts.slice(2),
  };
}

function parseDevLevelCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (normalizeText(parts[0]) !== ".devlevel") return null;

  const action = normalizeText(parts[1]);
  if (["resetgrupo", "resetargrupo", "zerargrupo"].includes(action)) {
    if (parts.length !== 2) return { type: "invalid", rawArgs: [] };
    return { type: "resetGroup", rawArgs: [] };
  }

  if (!["dar", "tirar", "setar", "resetar", "remover", "add", "set"].includes(action)) {
    return { type: "invalid", rawArgs: [] };
  }

  return {
    type: action === "tirar" || action === "remover" ? "remove" : action === "setar" || action === "set" ? "set" : action === "resetar" ? "reset" : "add",
    rawArgs: parts.slice(2),
  };
}

function getContextTargetJid(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo || {};
  return context.mentionedJid?.find(Boolean) || context.participant || "";
}

function resolveDevAssetTarget(msg, command) {
  const mentionedOrQuoted = getContextTargetJid(msg);
  const args = [...(command.rawArgs || [])];
  if (mentionedOrQuoted) {
    const mentionIndex = args.findIndex((part) => part.startsWith("@"));
    if (mentionIndex >= 0) args.splice(mentionIndex, 1);
    return { participantId: rank.normalizeParticipantId(mentionedOrQuoted), itemQuery: args.join(" ").trim() };
  }

  const targetQuery = args.shift() || "";
  const participantId = rank.findParticipantId?.(targetQuery) || "";
  return { participantId, itemQuery: args.join(" ").trim(), targetQuery };
}

function resolveDevLevelTarget(msg, command) {
  const mentionedOrQuoted = getContextTargetJid(msg);
  const args = [...(command.rawArgs || [])];
  if (mentionedOrQuoted) {
    const mentionIndex = args.findIndex((part) => part.startsWith("@"));
    if (mentionIndex >= 0) args.splice(mentionIndex, 1);
    return { participantId: rank.normalizeParticipantId(mentionedOrQuoted), amount: Number(args[0] || 0) };
  }

  const targetQuery = args.shift() || "";
  const participantId = rank.findParticipantId?.(targetQuery) || "";
  return { participantId, amount: Number(args[0] || 0), targetQuery };
}

function resolveRankTarget(msg, query = "") {
  const contextTarget = getContextTargetJid(msg);
  if (contextTarget) return rank.normalizeParticipantId(contextTarget);
  if (query) return rank.findParticipantId?.(query) || "";
  const rawParticipantId = getRankParticipantId(msg);
  return rank.resolveParticipantId(rawParticipantId, getRankDisplayName(msg, rawParticipantId));
}

function resolveSocialTarget(msg, rawArgs = []) {
  const args = [...(rawArgs || [])];
  const contextTarget = getContextTargetJid(msg);
  if (contextTarget) {
    const mentionIndex = args.findIndex((part) => part.startsWith("@"));
    if (mentionIndex >= 0) args.splice(mentionIndex, 1);
    return { participantId: rank.normalizeParticipantId(contextTarget), args };
  }

  const targetQuery = args.shift() || "";
  const participantId = rank.findParticipantId?.(targetQuery) || "";
  return { participantId, args, targetQuery };
}

function isProfileCommand(text = "") {
  return getCommandName(text) === config.commands.profile;
}

function parseProfileCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = normalizeText(parts[0]);
  if (command !== config.commands.profile) return null;
  if (parts.length === 1) return { type: "show" };

  const action = normalizeText(parts[1]);
  if (parts.length === 2 && (action === "temas" || action === "tema" || action === "loja")) {
    return { type: "themes" };
  }

  if (action === "comprar") {
    return { type: "buyTheme", query: parts.slice(2).join(" ").trim() };
  }

  if (action === "usar" || action === "tema") {
    return { type: "equipTheme", query: parts.slice(2).join(" ").trim() };
  }

  return { type: "invalid" };
}

function isCommandLike(text = "") {
  return normalizeText(text).startsWith(".");
}

function isPersonalCommandLike(text = "") {
  return false;
}

function isToImageCommand(text = "") {
  return normalizeText(text) === config.commands.toImage;
}

function parseTextStickerCommand(text = "") {
  const raw = String(text || "").trim();
  const command = config.commands.textSticker;
  const lower = raw.toLowerCase();

  if (lower === command) return { type: "missing", text: "" };
  if (!lower.startsWith(`${command} `)) return null;

  const value = raw.slice(command.length).trim();
  if (!value) return { type: "missing", text: "" };

  if (value.toLowerCase().startsWith("rgb ")) {
    const rgbText = value.slice(4).trim();
    return rgbText ? { type: "rgb", text: rgbText } : { type: "missing", text: "" };
  }

  return { type: "static", text: value };
}

function getAudioEffectCommand(text = "") {
  return getAudioEffectByCommand(text, config.commands.audioEffects);
}

function enqueueSticker(chatId, sourceMsg, media, options = {}) {
  conversionQueue = conversionQueue
    .catch(() => {})
    .then(() => sendSticker(chatId, sourceMsg, media, options));

  return conversionQueue;
}

async function downloadMedia(msg) {
  return downloadMediaMessage(msg, "buffer", {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  });
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPinterestUrl(value = "") {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it";
  } catch {
    return false;
  }
}

function getHeader(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase()) || "";
}

function getMediaTypeFromContentType(contentType = "") {
  const type = String(contentType).toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "";
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractPinterestMediaUrl(html = "") {
  const patterns = [
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i,
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /"video_url"\s*:\s*"([^"]+)"/i,
    /"image_url"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp|gif|mp4)[^"]*)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/"));
    }
  }

  return "";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        accept: "*/*",
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadUrlBuffer(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = getHeader(response.headers, "content-type");
  const mediaType = getMediaTypeFromContentType(contentType);
  if (!mediaType) throw new Error(`tipo inválido: ${contentType || "desconhecido"}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    type: mediaType,
    url: response.url || url,
    contentType,
  };
}

async function downloadPinterestMedia(url) {
  if (!isValidHttpUrl(url)) throw new Error("link inválido");
  if (!isPinterestUrl(url)) throw new Error("link não é do Pinterest");

  const direct = await fetchWithTimeout(url);
  if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
  const contentType = getHeader(direct.headers, "content-type");
  const mediaType = getMediaTypeFromContentType(contentType);
  if (mediaType) {
    return {
      buffer: Buffer.from(await direct.arrayBuffer()),
      type: mediaType,
      url: direct.url || url,
      contentType,
    };
  }

  const html = await direct.text();
  const mediaUrl = extractPinterestMediaUrl(html);
  if (!mediaUrl || !isValidHttpUrl(mediaUrl)) throw new Error("mídia não encontrada na página");
  return downloadUrlBuffer(mediaUrl);
}

function getReplyOptions(quoted = activeReplyMessage) {
  return quoted?.key ? { quoted } : undefined;
}

async function sendMessageWithFallback(chatId, message, replyOptions, label = "mensagem") {
  try {
    return replyOptions
      ? await sock.sendMessage(chatId, message, replyOptions)
      : await sock.sendMessage(chatId, message);
  } catch (err) {
    if (!replyOptions) throw err;

    logError(`Falha ao enviar ${label} citando mensagem; reenviando solto: ${err.message}`);
    return sock.sendMessage(chatId, message);
  }
}

async function sendText(chatId, text, options = {}) {
  const quoted = Object.prototype.hasOwnProperty.call(options, "quoted")
    ? options.quoted
    : activeReplyMessage;
  const replyOptions = getReplyOptions(quoted);
  const message = {
    text,
    ...(options.mentions ? { mentions: options.mentions } : {}),
  };
  const result = await sendMessageWithFallback(chatId, message, replyOptions, "texto");

  rememberBotSentMessage(result);
  rememberRecentMessage(result);
  return result;
}

async function withReplyMessage(msg, handler) {
  const previous = activeReplyMessage;
  activeReplyMessage = msg;

  try {
    return await handler();
  } finally {
    activeReplyMessage = previous;
  }
}

async function sendImage(chatId, image, options = {}) {
  const result = await sock.sendMessage(chatId, {
    image,
    mimetype: options.mimetype || "image/png",
    caption: options.caption,
  });
  rememberBotSentMessage(result);
  rememberRecentMessage(result);
}

async function sendAudio(chatId, audio, options = {}) {
  const result = await sock.sendMessage(chatId, {
    audio,
    mimetype: options.mimetype || "audio/ogg; codecs=opus",
    ptt: !!options.ptt,
  });
  rememberBotSentMessage(result);
  rememberRecentMessage(result);
}

async function sendGif(chatId, gif, options = {}) {
  const quoted = Object.prototype.hasOwnProperty.call(options, "quoted")
    ? options.quoted
    : activeReplyMessage;
  const replyOptions = getReplyOptions(quoted);
  const message = {
    video: gif,
    gifPlayback: true,
    mimetype: options.mimetype || "video/mp4",
    caption: options.caption,
    ...(options.mentions ? { mentions: options.mentions } : {}),
  };
  const result = await sendMessageWithFallback(chatId, message, replyOptions, "gif");
  rememberBotSentMessage(result);
  rememberRecentMessage(result);
  return result;
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

async function handleShopCommand(chatId, msg, text) {
  const command = rank.parseShopCommand(text);
  if (!command) return false;
  if (command.type === "invalid") return true;

  const rawParticipantId = getRankParticipantId(msg);
  const participantId = rank.resolveParticipantId(
    rawParticipantId,
    getRankDisplayName(msg, rawParticipantId)
  );

  if (command.type === "shop") {
    await sendText(chatId, rank.formatShop(participantId));
    return true;
  }

  if (command.type === "owned") {
    await sendText(chatId, rank.formatOwnedTags(participantId));
    return true;
  }

  if (command.type === "unequip") {
    rank.unequipTag(participantId);
    await sendText(chatId, "🚫 Tag removida do seu rank.");
    return true;
  }

  if (!command.query) {
    await sendText(chatId, command.type === "buy" ? 'Use assim: ".comprar tag"' : 'Use assim: ".usartag tag"');
    return true;
  }

  if (command.type === "buy") {
    const result = rank.buyTag(participantId, command.query, { allowLocked: !!msg.key?.fromMe });
    if (result.reason === "not_found") {
      await sendText(chatId, `Não encontrei a tag "${command.query}". Use .loja para ver as opções.`);
      return true;
    }
    if (result.reason === "locked") {
      await sendText(chatId, `🔒 ${result.tag.name} está bloqueada.`);
      return true;
    }
    if (result.reason === "already_owned") {
      await sendText(chatId, `Você já tem ${result.tag.name}. Use .usartag ${result.tag.id} para equipar.`);
      return true;
    }
    if (result.reason === "insufficient") {
      await sendText(chatId, `Saldo insuficiente para ${result.tag.name}.\nPreço: ${result.tag.price} pts\nSeu saldo: ${result.wallet.balance} pts`);
      return true;
    }

    await sendText(chatId, `✅ Comprou ${result.tag.name} por ${result.tag.price} pts!\nSaldo atual: ${result.wallet.balance} pts\nUse .usartag ${result.tag.id}`);
    return true;
  }

  if (command.type === "equip") {
    const result = rank.equipTag(participantId, command.query, { allowLocked: !!msg.key?.fromMe });
    if (result.reason === "not_found") {
      await sendText(chatId, `Não encontrei a tag "${command.query}". Use .loja para ver as opções.`);
      return true;
    }
    if (result.reason === "locked") {
      await sendText(chatId, `🔒 ${result.tag.name} está bloqueada.`);
      return true;
    }
    if (result.reason === "not_owned") {
      await sendText(chatId, `Você ainda não comprou ${result.tag.name}. Use .comprar ${result.tag.id}.`);
      return true;
    }

    await sendText(chatId, `🏷️ Tag equipada: ${result.tag.name}`);
    return true;
  }

  return false;
}

async function handleUtilityCommand(chatId, msg, text) {
  const devLevelCommand = parseDevLevelCommand(text);
  if (devLevelCommand) {
    if (!msg.key?.fromMe) return true;
    await handleDevLevelCommand(chatId, msg, devLevelCommand);
    return true;
  }

  const devAssetCommand = parseDevAssetCommand(text);
  if (devAssetCommand) {
    if (!msg.key?.fromMe) return true;
    await handleDevAssetCommand(chatId, msg, devAssetCommand);
    return true;
  }

  if (isDevMenuCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, DEV_MENU_TEXT);
    return true;
  }

  if (isStatusBotCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, formatStatusBot());
    return true;
  }

  if (isErrorsCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, formatRecentErrors());
    return true;
  }

  const aiControlCommand = parseAiControlCommand(text);
  if (aiControlCommand) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, handleAiControlCommand(aiControlCommand));
    return true;
  }

  const maintenanceCommand = parseMaintenanceCommand(text);
  if (maintenanceCommand) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, handleMaintenanceCommand(maintenanceCommand));
    return true;
  }

  if (isRestartCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await sendText(chatId, "🔄 Reiniciando o bot agora...");
    scheduleProcessRestart();
    return true;
  }

  const deleteMessagesCommand = parseDeleteMessagesCommand(text);
  if (deleteMessagesCommand) {
    if (!msg.key?.fromMe) return true;
    await handleDeleteMessagesCommand(chatId, msg, deleteMessagesCommand);
    return true;
  }

  if (isRaffleCommand(text)) {
    await handleRaffleCommand(chatId);
    return true;
  }

  const giftCommand = rank.parseGiftCommand(text);
  if (giftCommand) {
    await handleGiftCommand(chatId, msg, giftCommand);
    return true;
  }

  const marriageCommand = rank.parseMarriageCommand(text);
  if (marriageCommand) {
    await handleMarriageCommand(chatId, msg, marriageCommand);
    return true;
  }

  const xboxDealsCommand = parseXboxDealsCommand(text);
  if (xboxDealsCommand) {
    await handleXboxDealsCommand(chatId, xboxDealsCommand);
    return true;
  }

  const aiCommand = parseAiCommand(text);
  if (aiCommand) {
    await handleAiCommand(chatId, msg, aiCommand);
    return true;
  }

  if (isDailyCommand(text)) {
    await handleDailyCommand(chatId, msg);
    return true;
  }

  if (isRouletteCommand(text)) {
    await handleRouletteCommand(chatId, msg);
    return true;
  }

  if (isRouletteDevCommand(text)) {
    if (!msg.key?.fromMe) return true;
    await handleRouletteCommand(chatId, msg, { devMode: true });
    return true;
  }

  if (isProfileCommand(text)) {
    await handleProfileCommand(chatId, msg);
    return true;
  }

  const levelCommand = parseLevelCommand(text);
  if (levelCommand) {
    await handleLevelCommand(chatId, msg, levelCommand);
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

  const textSticker = parseTextStickerCommand(text);
  if (textSticker) {
    await handleTextStickerCommand(chatId, msg, textSticker);
    return true;
  }

  const audioEffect = getAudioEffectCommand(text);
  if (audioEffect) {
    await handleAudioEffectCommand(chatId, msg, audioEffect);
    return true;
  }

  return false;
}

async function handleLevelCommand(chatId, msg, command) {
  if (command.type === "invalid") return;

  if (!rank.isGroupJid(chatId)) {
    if (command.type === "topLevel") return;
  }

  if (command.type === "topLevel") {
    if (!rank.isRankEnabled(chatId)) {
      await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
      return;
    }
    await sendText(chatId, rank.formatTopLevel(rank.rankLevelGroup(chatId)));
    return;
  }

  if (rank.isGroupJid(chatId) && !rank.isRankEnabled(chatId)) {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return;
  }

  const participantId = resolveRankTarget(msg, command.query);
  if (!participantId) {
    await sendText(chatId, `Não encontrei "${command.query}". Use @menção, responda uma mensagem ou use o ID do rank.`);
    return;
  }

  const displayName = rank.getGlobalUserStats(participantId)?.displayName ||
    rank.sanitizeDisplayName(command.query) ||
    getRankDisplayName(msg, participantId);

  if (command.type === "achievements") {
    await sendText(chatId, rank.formatAchievements({ groupId: chatId, participantId, displayName }));
    return;
  }

  await sendText(chatId, rank.formatLevelCard({ groupId: chatId, participantId, displayName }));
}

async function handleDevLevelCommand(chatId, msg, command) {
  if (command.type === "invalid") {
    await sendText(chatId, 'Use ".devlevel dar/tirar/setar/resetar @user <xp>".');
    return;
  }

  if (!rank.isGroupJid(chatId)) {
    await sendText(chatId, "Use .devlevel dentro do grupo onde quer gerenciar o XP.");
    return;
  }

  if (!rank.isRankEnabled(chatId)) {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return;
  }

  if (command.type === "resetGroup") {
    rank.resetGroupLevel(chatId);
    await sendText(chatId, "✅ Level/XP zerado para todos neste grupo.");
    return;
  }

  const { participantId, amount, targetQuery } = resolveDevLevelTarget(msg, command);
  if (!participantId) {
    await sendText(chatId, `Não encontrei o usuário${targetQuery ? ` "${targetQuery}"` : ""}. Use @menção, responda uma mensagem ou use o ID do rank.`);
    return;
  }

  const displayName = rank.getGlobalUserStats(participantId)?.displayName || rank.getSafeDisplayName({ displayName: targetQuery });
  const userLabel = `id ${rank.getRankUserId(participantId)}`;

  if (command.type === "reset") {
    rank.setLevelXp({ groupId: chatId, participantId, displayName, xp: 0 });
    await sendText(chatId, `✅ XP de ${userLabel} zerado neste grupo.`);
    return;
  }

  const points = Math.max(0, Math.floor(Number(amount) || 0));
  if (!points) {
    await sendText(chatId, 'Informe um valor de XP. Ex: ".devlevel dar @user 500".');
    return;
  }

  if (command.type === "add") {
    rank.addLevelXp({ groupId: chatId, participantId, displayName, xp: points });
    await sendText(chatId, `✅ +${points} XP para ${userLabel} neste grupo.`);
    return;
  }

  if (command.type === "remove") {
    const result = rank.removeLevelXp({ groupId: chatId, participantId, xp: points });
    if (!result.ok) {
      await sendText(chatId, `Não consegui remover ${points} XP deste usuário.`);
      return;
    }
    await sendText(chatId, `✅ -${points} XP de ${userLabel}.`);
    return;
  }

  rank.setLevelXp({ groupId: chatId, participantId, displayName, xp: points });
  await sendText(chatId, `✅ XP de ${userLabel} definido para ${points} neste grupo.`);
}

async function handleProfileCommand(chatId, msg) {
  const command = parseProfileCommand(getText(msg.message));
  if (!command || command.type === "invalid") {
    await sendText(chatId, 'Use ".perfil", ".perfil temas", ".perfil comprar <tema>" ou ".perfil tema <tema>".');
    return;
  }

  const rawParticipantId = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, rawParticipantId);
  const participantId = rank.resolveParticipantId(rawParticipantId, displayName);

  if (command.type === "themes") {
    await sendText(chatId, rank.formatProfileThemeShop(participantId));
    return;
  }

  if (command.type === "buyTheme") {
    if (!command.query) {
      await sendText(chatId, 'Use assim: ".perfil comprar neon"');
      return;
    }

    const result = rank.buyProfileTheme(participantId, command.query, { allowLocked: !!msg.key?.fromMe });
    if (result.reason === "not_found") {
      await sendText(chatId, `Não encontrei o tema "${command.query}". Use .perfil temas.`);
      return;
    }
    if (result.reason === "locked") {
      await sendText(chatId, `🔒 ${result.theme.name} está bloqueado.`);
      return;
    }
    if (result.reason === "already_owned") {
      await sendText(chatId, `Você já tem ${result.theme.name}. Use .perfil tema ${result.theme.id}.`);
      return;
    }
    if (result.reason === "insufficient") {
      await sendText(chatId, `Saldo insuficiente para ${result.theme.name}.\nPreço: ${result.theme.price} pts\nSeu saldo: ${result.wallet.balance} pts`);
      return;
    }

    await sendText(chatId, `✅ Comprou o tema ${result.theme.name}!\nSaldo atual: ${result.wallet.balance} pts\nUse .perfil tema ${result.theme.id}`);
    return;
  }

  if (command.type === "equipTheme") {
    if (!command.query) {
      await sendText(chatId, 'Use assim: ".perfil tema neon"');
      return;
    }

    const result = rank.equipProfileTheme(participantId, command.query, { allowLocked: !!msg.key?.fromMe });
    if (result.reason === "not_found") {
      await sendText(chatId, `Não encontrei o tema "${command.query}". Use .perfil temas.`);
      return;
    }
    if (result.reason === "locked") {
      await sendText(chatId, `🔒 ${result.theme.name} está bloqueado.`);
      return;
    }
    if (result.reason === "not_owned") {
      await sendText(chatId, `Você ainda não comprou ${result.theme.name}. Use .perfil comprar ${result.theme.id}.`);
      return;
    }

    await sendText(chatId, `🎨 Tema equipado: ${result.theme.name}`);
    return;
  }

  await sendText(chatId, rank.formatUserProfile({
    groupId: chatId,
    participantId,
    displayName,
  }));
}

async function handleDevAssetCommand(chatId, msg, command) {
  const label = command.asset === "tag" ? "tag" : "tema";
  if (command.type === "invalid") {
    await sendText(chatId, `Use ".dev${command.asset === "tag" ? "tag" : "tema"} dar/tirar/usar @user <${label}>".`);
    return;
  }

  const { participantId, itemQuery, targetQuery } = resolveDevAssetTarget(msg, command);
  if (!participantId) {
    await sendText(chatId, `Não encontrei o usuário${targetQuery ? ` "${targetQuery}"` : ""}. Use @menção, responda uma mensagem ou use o ID do rank.`);
    return;
  }

  if (!itemQuery) {
    await sendText(chatId, `Informe ${label}. Ex: ".dev${command.asset === "tag" ? "tag" : "tema"} ${command.type === "grant" ? "dar" : command.type === "revoke" ? "tirar" : "usar"} @user ${command.asset === "tag" ? "dragao" : "neon"}".`);
    return;
  }

  const userLabel = `id ${rank.getRankUserId(participantId)}`;
  if (command.asset === "tag") {
    const result = command.type === "revoke"
      ? rank.revokeTag(participantId, itemQuery)
      : rank.grantTag(participantId, itemQuery, { allowLocked: true, equip: command.type === "equip" });

    if (result.reason === "not_found") {
      await sendText(chatId, `Não encontrei a tag "${itemQuery}".`);
      return;
    }

    if (result.all) {
      await sendText(chatId, `✅ Todas as tags removidas de ${userLabel}.`);
      return;
    }

    await sendText(chatId, command.type === "revoke"
      ? `✅ Tag removida de ${userLabel}: ${result.tag.name}`
      : command.type === "equip"
        ? `✅ Tag dada e equipada em ${userLabel}: ${result.tag.name}`
        : `✅ Tag dada para ${userLabel}: ${result.tag.name}`);
    return;
  }

  const result = command.type === "revoke"
    ? rank.revokeProfileTheme(participantId, itemQuery)
    : rank.grantProfileTheme(participantId, itemQuery, { allowLocked: true, equip: command.type === "equip" });

  if (result.reason === "not_found") {
    await sendText(chatId, `Não encontrei o tema "${itemQuery}".`);
    return;
  }

  if (result.all) {
    await sendText(chatId, `✅ Todos os temas removidos de ${userLabel}.`);
    return;
  }

  await sendText(chatId, command.type === "revoke"
    ? `✅ Tema removido de ${userLabel}: ${result.theme.name}`
    : command.type === "equip"
      ? `✅ Tema dado e equipado em ${userLabel}: ${result.theme.name}`
      : `✅ Tema dado para ${userLabel}: ${result.theme.name}`);
}

async function handleDeleteMessagesCommand(chatId, msg, command) {
  if (command.type === "invalid") {
    await sendText(chatId, 'Use assim: ".apagarmsg 10" — limite: 1 a 30 mensagens.');
    return true;
  }

  const keys = getRecentMessageKeys(chatId, command.amount, msg.key?.id);
  if (!keys.length) {
    await sendText(chatId, "Não encontrei mensagens recentes para apagar.");
    return true;
  }

  let deleted = 0;
  for (const key of keys) {
    try {
      await sock.sendMessage(chatId, { delete: key });
      deleted++;
    } catch (err) {
      logError(`Falha ao apagar mensagem ${key.id}: ${err.message}`);
    }
  }

  await sendText(chatId, `🧹 Tentei apagar ${keys.length} mensagem(ns). Apagadas: ${deleted}.`);
  return true;
}

async function handleDailyCommand(chatId, msg) {
  if (!rank.isGroupJid(chatId)) {
    await sendText(chatId, "🎁 O daily funciona dentro de grupos com rank ativo.");
    return;
  }

  if (!rank.isRankEnabled(chatId)) {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return;
  }

  const rawParticipantId = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, rawParticipantId);
  const participantId = rank.resolveParticipantId(rawParticipantId, displayName);
  const result = rank.claimDaily({
    groupId: chatId,
    participantId,
    displayName,
  });

  if (result.reason === "cooldown") {
    await sendText(chatId, `🎁 Você já pegou seu daily.\nVolte em: ${formatDuration(result.waitMs)}`);
    return;
  }

  if (!result.ok) {
    await sendText(chatId, "Não consegui liberar seu daily agora.");
    return;
  }

  const bonusText = result.tag
    ? `\n🏷️ Bônus ${result.tag.name}: +${result.bonusPoints} pts`
    : "";

  await sendText(chatId, `🎁 Daily resgatado: +${result.points} pts${bonusText}`);
}

function requireRankGroup(chatId) {
  if (!rank.isGroupJid(chatId)) return "not_group";
  if (!rank.isRankEnabled(chatId)) return "rank_disabled";
  return "";
}

async function handleGiftCommand(chatId, msg, command) {
  const groupError = requireRankGroup(chatId);
  if (groupError === "not_group") {
    await sendText(chatId, "🎁 O presente funciona dentro de grupos com rank ativo.");
    return true;
  }
  if (groupError === "rank_disabled") {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return true;
  }
  if (command.type === "invalid") {
    await sendText(chatId, 'Use assim: ".presente @user 100 mensagem opcional".');
    return true;
  }

  const fromRaw = getRankParticipantId(msg);
  const fromName = getRankDisplayName(msg, fromRaw);
  const fromId = rank.resolveParticipantId(fromRaw, fromName) || rank.normalizeParticipantId(fromRaw);
  const target = resolveSocialTarget(msg, command.rawArgs);
  const toId = target.participantId || rank.resolveParticipantId(target.targetQuery || "", target.targetQuery || "");
  if (!toId) {
    await sendText(chatId, "Marque alguém para receber o presente.");
    return true;
  }

  const toName = rank.getGlobalUserStats(toId)?.displayName || rank.sanitizeDisplayName(target.targetQuery) || "Participante";
  const result = rank.sendGift({
    groupId: chatId,
    fromId,
    fromName,
    toId,
    toName,
    amount: command.amount,
    message: command.message,
  });

  if (result.reason === "self") {
    await sendText(chatId, "🎁 Você não pode enviar presente para si mesmo.");
    return true;
  }
  if (result.reason === "min") {
    await sendText(chatId, `🎁 O mínimo para presente é ${result.min} pts.`);
    return true;
  }
  if (result.reason === "daily_limit") {
    await sendText(chatId, `🎁 Limite diário: ${result.limit} presentes por pessoa.`);
    return true;
  }
  if (result.reason === "insufficient") {
    await sendText(chatId, `🎁 Pontos insuficientes.\nVocê tem: ${result.wallet.balance} pts\nTentou enviar: ${command.amount} pts`);
    return true;
  }
  if (!result.ok) {
    await sendText(chatId, "🎁 Não consegui enviar esse presente agora.");
    return true;
  }

  const note = result.message ? `\n💬 ${result.message}` : "";
  await sendText(chatId, `🎁 PRESENTE ENVIADO\n${fromName} → ${toName}\nValor: ${result.amount} pts${note}\nSaldo atual: ${result.wallet.balance} pts`, { mentions: [toId] });
  return true;
}

async function handleMarriageCommand(chatId, msg, command) {
  const participantRaw = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, participantRaw);
  const participantId = rank.resolveParticipantId(participantRaw, displayName) || rank.normalizeParticipantId(participantRaw);

  if (command.type === "help") {
    await sendText(chatId, rank.formatMarriageHelp());
    return true;
  }
  if (command.type === "invalid") {
    await sendText(chatId, 'Use ".casamento" para ver todos os comandos.');
    return true;
  }

  const groupError = requireRankGroup(chatId);
  if (groupError === "not_group") {
    await sendText(chatId, "💍 Casamento funciona dentro de grupos com rank ativo.");
    return true;
  }
  if (groupError === "rank_disabled") {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return true;
  }

  if (command.type === "couple") {
    await sendText(chatId, rank.formatMarriageInfo({ groupId: chatId, participantId, displayName }));
    return true;
  }

  if (command.type === "propose") {
    const target = resolveSocialTarget(msg, command.rawArgs);
    const toId = target.participantId || rank.resolveParticipantId(target.targetQuery || "", target.targetQuery || "");
    if (!toId) {
      await sendText(chatId, 'Marque alguém: ".casar @user".');
      return true;
    }
    const toName = rank.getGlobalUserStats(toId)?.displayName || rank.sanitizeDisplayName(target.targetQuery) || "Participante";
    const result = rank.createMarriageProposal({ groupId: chatId, fromId: participantId, fromName: displayName, toId, toName });
    if (result.reason === "self") {
      await sendText(chatId, "💍 Você não pode casar consigo mesmo.");
      return true;
    }
    if (result.reason === "already_married") {
      await sendText(chatId, "💍 Uma das pessoas já está casada neste grupo.");
      return true;
    }
    if (result.reason === "cooldown" || result.reason === "target_cooldown") {
      await sendText(chatId, `💍 Ainda tem cooldown para casar: ${formatDuration(result.waitMs)}`);
      return true;
    }
    if (result.reason === "pending") {
      await sendText(chatId, "💍 Já existe um pedido pendente envolvendo uma dessas pessoas.");
      return true;
    }
    if (!result.ok) {
      await sendText(chatId, "💍 Não consegui criar esse pedido.");
      return true;
    }
    await sendText(chatId, `💍 PEDIDO DE CASAMENTO\n${displayName} pediu ${toName} em casamento!\n\n${toName}, responda com:\n.aceitarcasamento\nou\n.recusarcasamento\n\nExpira em 10 minutos.`, { mentions: [toId] });
    return true;
  }

  if (command.type === "accept") {
    const result = rank.acceptMarriage({ groupId: chatId, participantId, displayName });
    if (result.reason === "no_proposal") {
      await sendText(chatId, "💍 Não existe pedido de casamento para você.");
      return true;
    }
    if (result.reason === "expired") {
      await sendText(chatId, "💍 Esse pedido expirou.");
      return true;
    }
    if (!result.ok) {
      await sendText(chatId, "💍 Não consegui aceitar esse casamento.");
      return true;
    }
    await sendText(chatId, `💞 CASAMENTO CONFIRMADO\n${result.fromName} e ${result.toName} agora estão casados!\nBônus daily: +${Math.round(config.social.marriageDailyBonus * 100)}% para cada um.`, { mentions: [result.fromId, result.toId] });
    return true;
  }

  if (command.type === "decline") {
    const result = rank.declineMarriage({ groupId: chatId, participantId });
    await sendText(chatId, result.ok ? "💔 Pedido de casamento recusado." : "💍 Não existe pedido de casamento para você.");
    return true;
  }

  if (command.type === "cancel") {
    const result = rank.cancelMarriageProposal({ groupId: chatId, participantId });
    await sendText(chatId, result.ok ? "💍 Pedido de casamento cancelado." : "💍 Você não tem pedido pendente para cancelar.");
    return true;
  }

  if (command.type === "divorce") {
    const result = rank.divorceMarriage({ groupId: chatId, participantId });
    if (result.reason === "not_married") {
      await sendText(chatId, "💔 Você não está casado neste grupo.");
      return true;
    }
    await sendText(chatId, `💔 Divórcio concluído.\nVocê e ${result.partnerName} precisam esperar 3 dias para casar novamente.`);
    return true;
  }

  return false;
}

function getRouletteAssetPath(prizeId) {
  const baseDir = path.resolve(process.cwd(), config.roulette.assetDir);
  const mp4Path = path.join(baseDir, `roleta-${prizeId}.mp4`);
  if (fs.existsSync(mp4Path)) return mp4Path;
  return path.join(baseDir, `roleta-${prizeId}.gif`);
}

async function handleRouletteCommand(chatId, msg, options = {}) {
  if (!rank.isGroupJid(chatId)) {
    await sendText(chatId, "🎰 A roleta diária funciona dentro de grupos com rank ativo.");
    return;
  }

  if (!rank.isRankEnabled(chatId)) {
    await sendText(chatId, 'O ranking ainda não está ativo neste grupo. Use ".iniciarrank" para começar.');
    return;
  }

  const rawParticipantId = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, rawParticipantId);
  const participantId = rank.resolveParticipantId(rawParticipantId, displayName);
  const result = rank.claimRoulette({
    groupId: chatId,
    participantId,
    displayName,
    ignoreCooldown: !!options.devMode,
  });

  if (result.reason === "cooldown") {
    await sendText(chatId, `🎰 Você já girou a roleta hoje.\nVolte em: ${formatDuration(result.waitMs)}`);
    return;
  }

  if (!result.ok) {
    await sendText(chatId, "Não consegui girar a roleta agora.");
    return;
  }

  const assetPath = getRouletteAssetPath(result.id);
  const caption = options.devMode
    ? "🎰 Roleta DEV girando..."
    : "🎰 Roleta girando...";

  if (!fs.existsSync(assetPath)) {
    await sendText(chatId, caption);
    return;
  }

  const mimetype = assetPath.endsWith(".gif") ? "image/gif" : "video/mp4";
  await sendGif(chatId, fs.readFileSync(assetPath), { caption, mimetype });
}

async function handleRaffleCommand(chatId) {
  if (!rank.isGroupJid(chatId)) {
    await sendText(chatId, "🎲 O sorteio funciona dentro de grupos.");
    return;
  }

  try {
    const metadata = await sock.groupMetadata(chatId);
    const participants = getRaffleParticipants(metadata);
    if (!participants.length) {
      await sendText(chatId, "Não encontrei participantes para sortear.");
      return;
    }

    const selected = participants[Math.floor(Math.random() * participants.length)];
    const mention = formatMention(selected.id);
    await sendText(chatId, `🎲 Sorteado: ${mention}`, { mentions: [selected.id] });
  } catch (err) {
    logError(`Falha no sorteio: ${err.message}`);
    await sendText(chatId, "Não consegui sortear agora. Tente de novo em alguns segundos.");
  }
}

function getRaffleParticipants(metadata = {}) {
  const botJid = normalizeUserJid(sock?.user?.id || sock?.user?.jid || "");
  return (metadata.participants || [])
    .map((participant) => ({ id: getRaffleParticipantJid(participant) }))
    .filter((participant) => participant.id && participant.id !== botJid);
}

function getRaffleParticipantJid(participant = {}) {
  const candidates = [
    participant.id,
    participant.jid,
    participant.phoneNumber,
    participant.phone,
    participant.pn,
  ];

  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid) return jid;
  }

  return "";
}

function normalizePhoneJid(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";

  if (text.includes("@")) {
    const server = text.split("@")[1]?.toLowerCase();
    if (server !== "s.whatsapp.net") return "";
    const normalized = normalizeUserJid(text);
    return getPhoneFromJid(normalized) ? normalized : "";
  }

  const phone = text.replace(/\D/g, "");
  return phone.length >= 8 ? `${phone}@s.whatsapp.net` : "";
}

function formatMention(jid = "") {
  const phone = getPhoneFromJid(jid);
  return phone ? `@${phone}` : "@usuario";
}

async function handleProfileStickerCommand(chatId, msg) {
  const target = getTargetJidFromMessage(msg);
  if (!target) {
    await sendText(chatId, 'Marque alguém ou responda uma mensagem com ".figpp".');
    return;
  }

  try {
    const image = await downloadProfilePicture(target);
    const sticker = await imageToSticker(image);
    const stickerMessage = {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    };
    rememberBotSentMessage(await sendMessageWithFallback(chatId, stickerMessage, getReplyOptions(), "figurinha"));
  } catch (err) {
    logError(`Falha ao criar figurinha de perfil: ${err.message}`);
    await sendText(chatId, "Achei a pessoa, mas não consegui acessar a foto de perfil. Pode ser limitação/privacidade do WhatsApp ou formato do usuário no grupo.");
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

async function handleTextStickerCommand(chatId, msg, command) {
  if (command.type === "missing") {
    await sendText(chatId, 'Use assim: ".figtxt seu texto" ou ".figtxt rgb seu texto".');
    return;
  }

  try {
    await sock.sendMessage(chatId, { react: { text: "🔤", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});

    const sticker = command.type === "rgb"
      ? await rgbTextToSticker(command.text)
      : await textToSticker(command.text);

    rememberBotSentMessage(await sock.sendMessage(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    }, getReplyOptions()));

    await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
  } catch (err) {
    logError(`Falha ao criar figurinha de texto: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    await sendText(chatId, "Não consegui criar essa figurinha de texto.");
  }
}

async function handleAudioEffectCommand(chatId, msg, effectName) {
  const quoted = getQuotedAudio(msg);
  const recent = quoted ? null : getRecentAudio(chatId);
  const source = quoted || recent;

  if (!source) {
    await sendText(chatId, `Responda um áudio com "${config.commands.audioEffects[effectName]}" ou envie um áudio e depois o comando.`);
    return;
  }

  try {
    await sock.sendMessage(chatId, { react: { text: "🎧", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});

    const input = await downloadMedia(source.msg);
    const output = await convertAudio(input, effectName);
    await sendAudio(chatId, output, { ptt: source.audio?.isPtt });

    await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
  } catch (err) {
    logError(`Falha ao converter áudio: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    await sendText(chatId, "Não consegui editar esse áudio. Tente outro áudio ou um arquivo mais curto.");
  }
}

async function handlePinterestStickerCommand(chatId, msg, command) {
  if (!command || command.type === "invalid") {
    await sendText(chatId, 'Use assim: ".figpin https://pin.it/..."\nPode mandar até 5 links no mesmo comando.');
    return;
  }

  const urls = command.urls || [];
  const failed = [];

  try {
    await sock.sendMessage(chatId, { react: { text: "📌", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});

    for (let index = 0; index < urls.length; index += 1) {
      try {
        const media = await downloadPinterestMedia(urls[index]);
        const sticker = media.type === "video"
          ? await videoToSticker(media.buffer)
          : await imageToSticker(media.buffer);

        rememberBotSentMessage(await sock.sendMessage(chatId, {
          sticker,
          mimetype: "image/webp",
          packname: config.sticker.packname,
          author: config.sticker.author,
        }, getReplyOptions()));

        log(`Figurinha Pinterest enviada de ${media.url}`);
      } catch (err) {
        failed.push(index + 1);
        logError(`Falha no .figpin link ${index + 1}: ${err.message}`);
      }
    }

    await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});

    const notes = [];
    if (failed.length) notes.push(`falharam: ${failed.join(", ")}`);
    if (command.ignored) notes.push(`${command.ignored} link(s) ignorado(s), limite ${config.bot.maxPinterestLinks}`);
    if (notes.length) await sendText(chatId, `📌 .figpin finalizado — ${notes.join(" • ")}`);
  } catch (err) {
    logError(`Falha no .figpin: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    await sendText(chatId, "Não consegui pegar essa mídia do Pinterest. Tente outro link, de preferência o link direto do Pin.");
  }
}

async function downloadProfilePicture(target) {
  const candidates = getProfilePictureCandidates(target);
  const errors = [];

  for (const jid of candidates) {
    try {
      const url = await sock.profilePictureUrl(jid, "image");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      errors.push(`${jid}: ${err.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "sem candidatos");
}

function getTargetJidFromMessage(msg) {
  const unwrapped = unwrapMessage(msg.message);
  const context = unwrapped.extendedTextMessage?.contextInfo || {};
  const mentioned = context.mentionedJid?.find(Boolean);
  if (mentioned) return { jid: mentioned, source: "mentioned" };
  if (context.participant) return { jid: context.participant, source: "quoted" };
  return null;
}

function getProfilePictureCandidates(target) {
  const rawJid = typeof target === "string" ? target : target?.jid;
  const candidates = [];
  addCandidate(candidates, rawJid);
  addCandidate(candidates, normalizeUserJid(rawJid));

  const phone = getPhoneFromJid(rawJid);
  if (phone) {
    addCandidate(candidates, `${phone}@s.whatsapp.net`);
    addCandidate(candidates, `${phone}@c.us`);
  }

  return candidates;
}

function addCandidate(candidates, jid) {
  if (jid && !candidates.includes(jid)) candidates.push(jid);
}

function getPhoneFromJid(jid = "") {
  const user = String(jid || "").split("@")[0].split(":")[0];
  return /^\d+$/.test(user) ? user : "";
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
    `🛠️ Manutenção: ${maintenanceMode ? maintenanceSilentMode ? "ativada silenciosa" : "ativada" : "desativada"}`,
    `🤖 IA: ${aiEnabled ? "ativada" : aiSilentDisabled ? "desativada silenciosa" : "desativada"}`,
  ].join("\n");
}

function formatRecentErrors() {
  const lines = readRecentLogs(8);
  if (!lines.length) {
    return "📋 *Últimos erros/logs*\n\nNenhum log encontrado ainda.";
  }

  return [
    "📋 *Últimos erros/logs*",
    "",
    ...lines.map((line) => `• ${line.slice(0, 300)}`),
  ].join("\n");
}

function handleMaintenanceCommand(command) {
  if (command.action === "invalid") {
    return 'Use assim: ".manutencao on", ".manutencao off", ".manutencao status" ou ".manutencao on nologs".';
  }

  if (command.action === "on") {
    maintenanceMode = true;
    maintenanceSilentMode = !!command.silent;
  }
  if (command.action === "off") {
    maintenanceMode = false;
    maintenanceSilentMode = false;
  }

  return `🛠️ Manutenção ${maintenanceMode ? maintenanceSilentMode ? "ativada em modo silencioso" : "ativada" : "desativada"}.`;
}

function shouldBlockForMaintenance(msg, text, media) {
  if (!maintenanceMode || msg.key?.fromMe) return false;
  return isCommandLike(text) || isCommandLike(media?.caption);
}

function formatMaintenanceBlockMessage() {
  if (maintenanceSilentMode) return "";
  return "🛠️ O bot está em manutenção no momento. Tente novamente mais tarde.";
}

function resetMaintenanceForTests() {
  maintenanceMode = false;
  maintenanceSilentMode = false;
}

function scheduleProcessRestart(exitFn = () => process.exit(0), delayMs = 1200) {
  setTimeout(exitFn, delayMs).unref?.();
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

async function trackRankActivity(chatId, msg, text, media) {
  if (!rank.isGroupJid(chatId)) return;

  const rawParticipantId = getRankParticipantId(msg);
  const displayName = getRankDisplayName(msg, rawParticipantId);
  const participantId = rank.resolveParticipantId(rawParticipantId, displayName);
  const isSticker = isStickerMessage(msg.message);
  const points = rank.getMessageScore({
    text,
    media,
    isSticker,
  });
  const activityType = rank.getActivityType({ text, media, isSticker });

  rank.addActivity({
    groupId: chatId,
    participantId,
    displayName,
    points,
    activityType,
  });
}

function handleAiControlCommand(command) {
  if (command.action === "invalid") {
    return 'Use assim: ".iaon", ".iaoff" ou ".iaoff nologs".';
  }

  if (command.action === "on") {
    aiEnabled = true;
    aiSilentDisabled = false;
    return "🤖 IA ativada.";
  }

  aiEnabled = false;
  aiSilentDisabled = !!command.silent;
  return aiSilentDisabled
    ? "🤖 IA desativada em modo silencioso."
    : "🤖 IA desativada. Usuários serão avisados ao tentar usar.";
}

function resetAiControlForTests() {
  aiEnabled = true;
  aiSilentDisabled = false;
}

async function handleXboxDealsCommand(chatId, command) {
  if (command.type === "invalid") {
    await sendText(chatId, 'Use assim: ".xboxpromo".');
    return;
  }

  try {
    const result = await xboxDeals.getXboxDeals();
    await sendText(chatId, xboxDeals.formatXboxDeals(result.deals, { limit: command.limit }));
  } catch (err) {
    logError(`Falha no .xboxpromo: ${err.message}`);
    await sendText(chatId, `🎮 Não consegui buscar as promoções agora.\nVeja direto: ${config.xboxDeals.fallbackUrl}`);
  }
}

async function handleAiCommand(chatId, msg, command) {
  if (!aiEnabled) {
    if (!aiSilentDisabled) {
      await sendText(chatId, "🤖 A IA está desativada no momento.");
    }
    return;
  }

  if (command.type === "missing") {
    await sendText(chatId, 'Use assim: ".ia sua pergunta".');
    return;
  }

  const participantId = getRankParticipantId(msg) || msg.key?.remoteJid || chatId;
  const cooldown = nvidiaAi.checkCooldown(participantId);
  if (!cooldown.ok) {
    await sendText(chatId, `🤖 Calma aí 😄\nTente de novo em: ${formatDuration(cooldown.waitMs)}`);
    return;
  }

  const prompt = buildAiPrompt(command.prompt, msg);

  if (nvidiaAi.isSensitivePrompt(prompt)) {
    await sendText(chatId, "Não posso ajudar com chaves, tokens, sistema interno ou dados privados.");
    return;
  }

  try {
    const result = await nvidiaAi.askNvidiaAi(prompt);
    if (result.reason === "missing_key") {
      await sendText(chatId, "🤖 A IA ainda não está configurada no servidor.");
      return;
    }
    if (!result.ok) {
      await sendText(chatId, "🤖 Não consegui responder agora. Tente de novo em alguns segundos.");
      return;
    }

    await sendText(chatId, `🤖 ${result.answer}`);
  } catch (err) {
    logError(`Falha no .ia: ${err.message}`);
    await sendText(chatId, "🤖 Não consegui responder agora. Tente de novo em alguns segundos.");
  }
}

async function sendSticker(chatId, sourceMsg, media, options = {}) {
  try {
    await sock.sendMessage(chatId, { react: { text: "⏳", key: sourceMsg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    log(`Convertendo ${mediaLabel(media)} de ${chatId}`);

    const input = await downloadMedia(sourceMsg);
    const sticker = media.isImage
      ? await imageToSticker(input, { crop: !!options.crop })
      : await videoToSticker(input, { crop: !!options.crop });

    rememberBotSentMessage(await sock.sendMessage(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    }, getReplyOptions()));

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

async function handleStealStickerCommand(chatId, msg) {
  const quoted = getQuotedSticker(msg);
  if (!quoted) {
    await sendText(chatId, 'Responda uma figurinha com ".roubar".');
    return;
  }

  try {
    await sock.sendMessage(chatId, { react: { text: "⏳", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});

    const input = await downloadMedia(quoted.msg);
    const sticker = replaceStickerMetadata(input);
    const result = await sendMessageWithFallback(chatId, {
      sticker,
      mimetype: "image/webp",
      packname: config.sticker.packname,
      author: config.sticker.author,
    }, getReplyOptions(), "figurinha roubada");

    rememberBotSentMessage(result);
    rememberRecentMessage(result);
    await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    log(`Metadados da figurinha substituídos em ${chatId}`);
  } catch (err) {
    logError(`Falha no .roubar: ${err.message}`);
    await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } })
      .then(rememberBotSentMessage)
      .catch(() => {});
    await sendText(chatId, "Não consegui alterar os dados dessa figurinha.");
  }
}

async function processMessage(msg) {
  if (shouldIgnoreMessage(msg)) return;
  if (isBotSentMessage(msg)) return;
  if (isDuplicate(msg.key.id)) return;

  const chatId = msg.key.remoteJid;
  const text = getText(msg.message);
  const media = getMedia(msg.message);
  const audio = getAudio(msg.message);
  log(`Mensagem recebida de ${chatId}: ${messageSummary(msg)}`);
  rememberRecentMessage(msg);

  if (shouldBlockForMaintenance(msg, text, media)) {
    const maintenanceMessage = formatMaintenanceBlockMessage();
    if (maintenanceMessage) {
      await withReplyMessage(msg, () => sendText(chatId, maintenanceMessage));
    }
    return;
  }

  if (isMenuCommand(text)) {
    await withReplyMessage(msg, () => sendText(chatId, MENU_TEXT));
    return;
  }

  if (isStealStickerCommand(text)) {
    await withReplyMessage(msg, () => handleStealStickerCommand(chatId, msg));
    return;
  }

  if (await withReplyMessage(msg, () => handleUtilityCommand(chatId, msg, text))) {
    return;
  }

  if (await withReplyMessage(msg, () => handleRankCommand(chatId, msg, text))) {
    return;
  }

  if (await withReplyMessage(msg, () => handleShopCommand(chatId, msg, text))) {
    return;
  }

  await trackRankActivity(chatId, msg, text, media);

  if (media && isAnyStickerCommand(media.caption)) {
    await withReplyMessage(msg, () => enqueueSticker(chatId, msg, media, {
      crop: isStickerCropCommand(media.caption),
    }));
    return;
  }

  if (media) {
    rememberMedia(chatId, msg, media);
    return;
  }

  if (audio) {
    rememberAudio(chatId, msg, audio);
    return;
  }

  const pinterestSticker = parsePinterestStickerCommand(text);
  if (pinterestSticker) {
    await withReplyMessage(msg, () => handlePinterestStickerCommand(chatId, msg, pinterestSticker));
    return;
  }

  if (!isAnyStickerCommand(text)) return;

  const crop = isStickerCropCommand(text);

  const quoted = getQuotedMedia(msg);
  if (quoted) {
    await withReplyMessage(msg, () => enqueueSticker(chatId, quoted.msg, quoted.media, { crop }));
    return;
  }

  const recent = getRecentMedia(chatId);
  if (recent) {
    await withReplyMessage(msg, () => enqueueSticker(chatId, recent.msg, recent.media, { crop }));
    return;
  }

  await withReplyMessage(msg, () => sendText(chatId, 'Mande uma imagem/vídeo com legenda ".fig", responda uma mídia com ".fig", ou envie a mídia e depois ".fig".'));
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

function shouldClearSessionForDisconnect(code) {
  return code === DisconnectReason.loggedOut || code === DisconnectReason.badSession;
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

      if (shouldClearSessionForDisconnect(code)) {
        const sessionReason = code === DisconnectReason.badSession ? "badSession" : "logged_out";
        status = sessionReason;
        lastDisconnectInfo = reason;
        clearSession();
        currentQR = null;
        logError("Sessão inválida/desconectada. Limpando apenas login do WhatsApp para gerar QR novo.");
        scheduleReconnect(sessionReason);
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
    getAudio,
    getQuotedMedia,
    getQuotedAudio,
    getQuotedSticker,
    getQuotedText,
    getRecentAudio,
    getRecentMedia,
    getSticker,
    getPhoneFromJid,
    getProfilePictureCandidates,
    getTargetJidFromMessage,
    getText,
    handleRankCommand,
    handleShopCommand,
    handleUtilityCommand,
    isDuplicate,
    isDevMenuCommand,
    isMenuCommand,
    isAnyStickerCommand,
    isStickerCropCommand,
    isStealStickerCommand,
    isBotSentMessage,
    isProfileStickerCommand,
    isStickerMessage,
    isStickerCommand,
    isStatusBotCommand,
    isErrorsCommand,
    isRestartCommand,
    isRaffleCommand,
    isDailyCommand,
    isRouletteCommand,
    isRouletteDevCommand,
    isProfileCommand,
    parseDevAssetCommand,
    parseDevLevelCommand,
    parseLevelCommand,
    parseXboxDealsCommand,
    parseAiCommand,
    parseAiControlCommand,
    parsePinterestStickerCommand,
    parseProfileCommand,
    resolveDevAssetTarget,
    resolveDevLevelTarget,
    isToImageCommand,
    parseMaintenanceCommand,
    parseDeleteMessagesCommand,
    getAudioEffectCommand,
    parseTextStickerCommand,
    DEV_MENU_TEXT,
    MENU_TEXT,
    formatBytes,
    formatDuration,
    formatRecentErrors,
    formatMention,
    getRaffleParticipantJid,
    getRaffleParticipants,
    normalizePhoneJid,
    formatMaintenanceBlockMessage,
    handleMaintenanceCommand,
    handleAiControlCommand,
    handleXboxDealsCommand,
    handleAiCommand,
    buildAiPrompt,
    handleRouletteCommand,
    getRouletteAssetPath,
    formatStatusBot,
    getReplyOptions,
    sendMessageWithFallback,
    getRecentMessageKeys,
    rememberRecentMessage,
    scheduleProcessRestart,
    shouldClearSessionForDisconnect,
    shouldBlockForMaintenance,
    resetAiControlForTests,
    resetMaintenanceForTests,
    isPersonalCommandLike,
    normalizeText,
    setSockForTests,
    normalizeUserJid,
    downloadPinterestMedia,
    extractPinterestMediaUrl,
    getMediaTypeFromContentType,
    isPinterestUrl,
    isValidHttpUrl,
    rememberBotSentMessage,
    rememberAudio,
    rememberMedia,
    shouldIgnoreMessage,
    trackRankActivity,
    unwrapMessage,
  },
};
