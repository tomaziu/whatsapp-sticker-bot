const fs = require("fs");
const path = require("path");
const config = require("../config");

let stats = null;
let saveTimer = null;
const lastScoredAt = new Map();

function loadStats() {
  if (stats) return stats;

  try {
    stats = JSON.parse(fs.readFileSync(getStatsPath(), "utf8"));
  } catch {
    stats = { groups: {} };
  }

  if (!stats.groups) stats.groups = {};
  if (!stats.enabledGroups) stats.enabledGroups = {};
  if (!stats.rankIds) stats.rankIds = {};
  if (!stats.shop) stats.shop = { users: {} };
  if (!stats.shop.users) stats.shop.users = {};
  if (!stats.daily) stats.daily = { users: {} };
  if (!stats.daily.users) stats.daily.users = {};
  if (!stats.roulette) stats.roulette = { users: {} };
  if (!stats.roulette.users) stats.roulette.users = {};
  if (!stats.social) stats.social = {};
  if (!stats.social.gifts) stats.social.gifts = { users: {}, history: [] };
  if (!stats.social.gifts.users) stats.social.gifts.users = {};
  if (!Array.isArray(stats.social.gifts.history)) stats.social.gifts.history = [];
  if (!stats.social.marriages) stats.social.marriages = { groups: {} };
  if (!stats.social.marriages.groups) stats.social.marriages.groups = {};
  const migrated = migrateParticipantIds(stats);
  const shopMigrated = migrateShopInventory(stats);
  if (!stats.nextRankId) stats.nextRankId = getNextRankId(stats.rankIds);
  if (migrated || shopMigrated) scheduleSave();
  return stats;
}

function getStatsPath() {
  return path.resolve(process.cwd(), config.paths.rankStats);
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(getStatsPath()), { recursive: true });
}

function saveStatsNow() {
  ensureDataDir();
  fs.writeFileSync(getStatsPath(), JSON.stringify(loadStats(), null, 2));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStatsNow();
  }, 1000);
}

function isGroupJid(jid = "") {
  return jid.endsWith("@g.us");
}

function getParticipantId(msg) {
  return normalizeParticipantId(msg.key?.participant || msg.participant || msg.key?.remoteJid);
}

function getDisplayName(msg, participantId = getParticipantId(msg)) {
  return sanitizeDisplayName(msg.pushName) || sanitizeDisplayName(participantId) || "Participante";
}

function sanitizeDisplayName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("@")) return "";
  if (/^\+?\d[\d\s().-]{5,}$/.test(text)) return "";
  return text;
}

function getSafeDisplayName(user = {}) {
  return sanitizeDisplayName(user.displayName) || "Participante";
}

function getRankUserId(participantId = "") {
  participantId = normalizeParticipantId(participantId);
  if (!participantId || isGroupJid(participantId)) return "--";

  const root = loadStats();
  if (!root.rankIds[participantId]) {
    root.rankIds[participantId] = root.nextRankId || getNextRankId(root.rankIds);
    root.nextRankId = root.rankIds[participantId] + 1;
    scheduleSave();
  }

  return formatRankId(root.rankIds[participantId]);
}

function getUsefulDisplayName(value = "") {
  const text = sanitizeDisplayName(value);
  if (!text || text === "Participante") return "";
  return text;
}

function normalizeCommand(text = "") {
  return String(text).trim().toLowerCase().split(/\s+/);
}

function isRankCommand(text = "") {
  const [command] = normalizeCommand(text);
  return [
    config.commands.rank,
    config.commands.myRank,
    config.commands.startRank,
    config.commands.resetRank,
    config.commands.removeRank,
    config.commands.level,
    config.commands.topLevel,
    config.commands.achievements,
    config.commands.shop,
    config.commands.buyTag,
    config.commands.useTag,
    config.commands.myTags,
    config.commands.removeTag,
    config.commands.gift,
    config.commands.marriage,
    config.commands.marry,
    config.commands.acceptMarriage,
    config.commands.declineMarriage,
    config.commands.cancelMarriage,
    config.commands.divorce,
    config.commands.couple,
  ].includes(command);
}

function parseRankCommand(text = "") {
  const parts = normalizeCommand(text);
  const [command, arg] = parts;

  if (command === config.commands.startRank) {
    if (parts.length !== 1) return { type: "invalid" };
    return { type: "start" };
  }

  if (command === config.commands.resetRank) {
    if (parts.length > 2 || (parts.length === 2 && arg !== "global")) return { type: "invalid" };
    return { type: "reset", scope: arg === "global" ? "global" : "group" };
  }

  if (command === config.commands.removeRank) {
    return { type: "remove", query: getCommandTail(text) };
  }

  if (command === config.commands.myRank) {
    if (parts.length !== 1) return { type: "invalid" };
    return { type: "me" };
  }

  if (command !== config.commands.rank) {
    return null;
  }

  if (parts.length === 1) return { type: "group" };
  if (parts.length === 2 && arg === "global") return { type: "global" };
  if (parts.length === 2 && (arg === "me" || arg === "eu")) return { type: "me" };
  if (parts.length === 2 && (arg === "help" || arg === "ajuda")) return { type: "help" };
  return { type: "invalid" };
}

function getCommandTail(text = "") {
  return String(text || "").trim().split(/\s+/).slice(1).join(" ").trim();
}

function parseShopCommand(text = "") {
  const parts = normalizeCommand(text);
  const [command] = parts;

  if (command === config.commands.shop) {
    if (parts.length !== 1) return { type: "invalid" };
    return { type: "shop" };
  }

  if (command === config.commands.buyTag) {
    return { type: "buy", query: getCommandTail(text) };
  }

  if (command === config.commands.useTag) {
    return { type: "equip", query: getCommandTail(text) };
  }

  if (command === config.commands.myTags) {
    if (parts.length !== 1) return { type: "invalid" };
    return { type: "owned" };
  }

  if (command === config.commands.removeTag) {
    if (parts.length !== 1) return { type: "invalid" };
    return { type: "unequip" };
  }

  return null;
}

function isRankEnabled(groupId) {
  return !!loadStats().enabledGroups[groupId];
}

function setRankEnabled(groupId, enabled, now = Date.now()) {
  if (!isGroupJid(groupId)) return false;

  const root = loadStats();
  root.enabledGroups[groupId] = enabled
    ? { enabledAt: new Date(now).toISOString() }
    : undefined;

  if (!enabled) delete root.enabledGroups[groupId];
  scheduleSave();
  return true;
}

function startRank(groupId, now = Date.now()) {
  if (!isGroupJid(groupId)) return false;

  const root = loadStats();
  if (!root.enabledGroups[groupId]) {
    root.groups[groupId] = { users: {}, updatedAt: null };
  }

  return setRankEnabled(groupId, true, now);
}

function getMessageScore({ text, media, isSticker }) {
  if (isRankCommand(text)) return 0;
  if (String(text || "").trim().startsWith(".")) return 0;
  if (isSticker) return config.rank.points.sticker;
  if (media) return config.rank.points.media;
  if (String(text || "").trim()) return config.rank.points.text;
  return 0;
}

function getActivityType({ text, media, isSticker }) {
  if (getMessageScore({ text, media, isSticker }) <= 0) return "";
  if (isSticker) return "sticker";
  if (media) return "media";
  return "text";
}

function ensureUserActivityFields(user = {}) {
  user.textMessages = Math.max(0, Number(user.textMessages) || 0);
  user.mediaMessages = Math.max(0, Number(user.mediaMessages) || 0);
  user.stickerMessages = Math.max(0, Number(user.stickerMessages) || 0);
  user.achievements = user.achievements && typeof user.achievements === "object" ? user.achievements : {};
  return user;
}

function updateActivityAchievements(user, now = Date.now()) {
  ensureUserActivityFields(user);
  const hour = getSaoPauloHour(now);
  if (hour >= 5 && hour <= 7) user.achievements.earlyBird = true;
  if (hour >= 0 && hour <= 4) user.achievements.nightOwl = true;
  return user.achievements;
}

function getSaoPauloHour(now = Date.now()) {
  return Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(now)));
}

function getXpForNextLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return Math.floor(config.rank.levelBaseXp * Math.pow(config.rank.levelGrowth, safeLevel - 1));
}

function getLevelInfo(xp = 0) {
  const totalXp = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  let usedXp = 0;
  let nextLevelXp = getXpForNextLevel(level);

  while (totalXp >= usedXp + nextLevelXp) {
    usedXp += nextLevelXp;
    level += 1;
    nextLevelXp = getXpForNextLevel(level);
  }

  const currentXp = totalXp - usedXp;
  const progress = nextLevelXp > 0 ? Math.floor((currentXp / nextLevelXp) * 100) : 100;
  return {
    level,
    totalXp,
    currentXp,
    nextLevelXp,
    progress,
    remainingXp: Math.max(0, nextLevelXp - currentXp),
  };
}

function parseGiftCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = normalizeCommand(raw)[0];
  if (command !== config.commands.gift) return null;
  if (parts.length < 3) return { type: "invalid" };

  const amountIndex = parts.findIndex((part, index) => index > 0 && /^\d+$/.test(part));
  if (amountIndex < 0) return { type: "invalid" };

  return {
    type: "gift",
    rawArgs: parts.slice(1),
    amount: Number(parts[amountIndex]),
    message: parts.slice(amountIndex + 1).join(" ").trim(),
  };
}

function parseMarriageCommand(text = "") {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const [command] = normalizeCommand(raw);

  if (command === config.commands.marriage) {
    const arg = normalizeCommand(raw)[1];
    if (parts.length === 1) return { type: "help" };
    if (parts.length === 2 && (arg === "help" || arg === "ajuda")) return { type: "help" };
    return { type: "invalid" };
  }
  if (command === config.commands.marry) return { type: "propose", rawArgs: parts.slice(1) };
  if (command === config.commands.acceptMarriage) return parts.length === 1 ? { type: "accept" } : { type: "invalid" };
  if (command === config.commands.declineMarriage) return parts.length === 1 ? { type: "decline" } : { type: "invalid" };
  if (command === config.commands.cancelMarriage) return parts.length === 1 ? { type: "cancel" } : { type: "invalid" };
  if (command === config.commands.divorce) return parts.length === 1 ? { type: "divorce" } : { type: "invalid" };
  if (command === config.commands.couple) return parts.length === 1 ? { type: "couple" } : { type: "invalid" };
  return null;
}

function getUserLevelXp(user = {}) {
  if (Number.isFinite(user.levelXp)) return Math.max(0, Math.floor(user.levelXp));
  return Math.max(0, Math.floor(Number(user.points) || 0));
}

function formatProgressBar(progress = 0, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((Number(progress) || 0) / 100 * size)));
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function canScore(groupId, participantId, now = Date.now()) {
  const key = `${groupId}:${participantId}`;
  const last = lastScoredAt.get(key) || 0;
  if (now - last < config.rank.antiSpamMs) return false;
  lastScoredAt.set(key, now);
  return true;
}

function addActivity({ groupId, participantId, displayName, points, activityType = "text", now = Date.now() }) {
  participantId = normalizeParticipantId(participantId);
  if (!config.rank.enabled || !isGroupJid(groupId) || !participantId || points <= 0) return null;
  if (isGroupJid(participantId)) return null;
  if (!isRankEnabled(groupId)) return null;
  if (!canScore(groupId, participantId, now)) return null;

  const root = loadStats();
  getRankUserId(participantId);
  const group = root.groups[groupId] || { users: {}, updatedAt: null };
  const safeDisplayName = sanitizeDisplayName(displayName);
  const usefulDisplayName = getUsefulDisplayName(displayName);
  const user = group.users[participantId] || {
    points: 0,
    levelXp: 0,
    messages: 0,
    textMessages: 0,
    mediaMessages: 0,
    stickerMessages: 0,
    achievements: {},
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  ensureUserActivityFields(user);
  const previousLevel = getLevelInfo(getUserLevelXp(user)).level;
  const scoredPoints = points + getPointMagnetBonus(participantId, now);
  user.points += scoredPoints;
  user.levelXp = getUserLevelXp(user) + scoredPoints;
  user.messages += 1;
  if (activityType === "sticker") user.stickerMessages += 1;
  else if (activityType === "media") user.mediaMessages += 1;
  else user.textMessages += 1;
  updateActivityAchievements(user, now);
  if (usefulDisplayName || !getUsefulDisplayName(user.displayName)) {
    user.displayName = usefulDisplayName || safeDisplayName || "Participante";
  }
  user.lastActivityAt = new Date(now).toISOString();
  group.users[participantId] = user;
  group.updatedAt = user.lastActivityAt;
  root.groups[groupId] = group;

  const currentLevel = getLevelInfo(getUserLevelXp(user)).level;
  const levelUp = currentLevel > previousLevel
    ? { previousLevel, level: currentLevel, info: getLevelInfo(getUserLevelXp(user)) }
    : null;

  scheduleSave();
  return { ...user, participantId, levelUp, pointsGained: scoredPoints };
}

function rankGroup(groupId, limit = config.rank.topLimit) {
  if (!isRankEnabled(groupId)) return [];
  const group = loadStats().groups[groupId];
  if (!group) return [];
  return sortUsers(group.users).slice(0, limit);
}

function rankGlobal(limit = config.rank.topLimit) {
  const merged = {};
  const root = loadStats();
  for (const [groupId, group] of Object.entries(root.groups)) {
    if (!root.enabledGroups[groupId]) continue;
    for (const [rawParticipantId, user] of Object.entries(group.users || {})) {
      const participantId = normalizeParticipantId(rawParticipantId);
      if (!participantId || isGroupJid(participantId)) continue;

      const current = merged[participantId] || {
        points: 0,
        levelXp: 0,
        messages: 0,
        displayName: user.displayName,
        lastActivityAt: null,
      };
      current.points += user.points || 0;
      current.levelXp += getUserLevelXp(user);
      current.messages += user.messages || 0;
      current.displayName = user.displayName || current.displayName;
      current.lastActivityAt = maxDate(current.lastActivityAt, user.lastActivityAt);
      merged[participantId] = current;
    }
  }
  return sortUsers(merged).slice(0, limit);
}

function getGlobalUserStats(participantId) {
  participantId = normalizeParticipantId(participantId);
  if (!participantId || isGroupJid(participantId)) return null;

  const root = loadStats();
  const total = {
    participantId,
    points: 0,
    levelXp: 0,
    messages: 0,
    displayName: "",
    lastActivityAt: null,
  };

  for (const [groupId, group] of Object.entries(root.groups || {})) {
    if (!root.enabledGroups[groupId]) continue;
    const user = group.users?.[participantId];
    if (!user) continue;

    total.points += user.points || 0;
    total.levelXp += getUserLevelXp(user);
    total.messages += user.messages || 0;
    total.displayName = user.displayName || total.displayName;
    total.lastActivityAt = maxDate(total.lastActivityAt, user.lastActivityAt);
  }

  return total.points || total.messages ? total : null;
}

function resolveParticipantId(participantId, displayName = "") {
  participantId = normalizeParticipantId(participantId);
  if (getGlobalUserStats(participantId)) return participantId;

  const usefulName = getUsefulDisplayName(displayName);
  const normalizedName = normalizeName(usefulName);
  if (!normalizedName) return participantId;

  const candidates = findParticipantsByDisplayName(normalizedName);
  if (!candidates.length) return participantId;

  const resolvedId = candidates[0].participantId;
  mergeShopParticipant(participantId, resolvedId);
  return resolvedId;
}

function addRankPoints({ groupId, participantId, displayName, points, now = Date.now(), countMessage = false }) {
  participantId = normalizeParticipantId(participantId);
  points = Math.max(0, Math.floor(Number(points) || 0));
  if (!config.rank.enabled || !isGroupJid(groupId) || !participantId || points <= 0) return null;
  if (isGroupJid(participantId)) return null;
  if (!isRankEnabled(groupId)) return null;

  const root = loadStats();
  getRankUserId(participantId);
  const group = root.groups[groupId] || { users: {}, updatedAt: null };
  const safeDisplayName = sanitizeDisplayName(displayName);
  const usefulDisplayName = getUsefulDisplayName(displayName);
  const user = group.users[participantId] || {
    points: 0,
    levelXp: 0,
    messages: 0,
    textMessages: 0,
    mediaMessages: 0,
    stickerMessages: 0,
    achievements: {},
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  user.points += points;
  user.levelXp = getUserLevelXp(user) + points;
  if (countMessage) user.messages += 1;
  ensureUserActivityFields(user);
  if (usefulDisplayName || !getUsefulDisplayName(user.displayName)) {
    user.displayName = usefulDisplayName || safeDisplayName || "Participante";
  }
  user.lastActivityAt = new Date(now).toISOString();
  group.users[participantId] = user;
  group.updatedAt = user.lastActivityAt;
  root.groups[groupId] = group;
  scheduleSave();
  return participantId;
}

function setRankPoints({ groupId, participantId, displayName, points, now = Date.now() }) {
  participantId = normalizeParticipantId(participantId);
  points = Math.max(0, Math.floor(Number(points) || 0));
  if (!config.rank.enabled || !isGroupJid(groupId) || !participantId) return null;
  if (isGroupJid(participantId)) return null;
  if (!isRankEnabled(groupId)) return null;

  const root = loadStats();
  getRankUserId(participantId);
  const group = root.groups[groupId] || { users: {}, updatedAt: null };
  const safeDisplayName = sanitizeDisplayName(displayName);
  const usefulDisplayName = getUsefulDisplayName(displayName);
  const user = group.users[participantId] || {
    points: 0,
    levelXp: 0,
    messages: 0,
    textMessages: 0,
    mediaMessages: 0,
    stickerMessages: 0,
    achievements: {},
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  user.points = points;
  ensureUserActivityFields(user);
  if (usefulDisplayName || !getUsefulDisplayName(user.displayName)) {
    user.displayName = usefulDisplayName || safeDisplayName || "Participante";
  }
  user.lastActivityAt = new Date(now).toISOString();
  group.users[participantId] = user;
  group.updatedAt = user.lastActivityAt;
  root.groups[groupId] = group;
  scheduleSave();
  return user;
}

function addLevelXp({ groupId, participantId, displayName, xp, now = Date.now() }) {
  participantId = normalizeParticipantId(participantId);
  xp = Math.max(0, Math.floor(Number(xp) || 0));
  if (!config.rank.enabled || !isGroupJid(groupId) || !participantId || xp <= 0) return null;
  if (isGroupJid(participantId)) return null;
  if (!isRankEnabled(groupId)) return null;

  const root = loadStats();
  getRankUserId(participantId);
  const group = root.groups[groupId] || { users: {}, updatedAt: null };
  const safeDisplayName = sanitizeDisplayName(displayName);
  const usefulDisplayName = getUsefulDisplayName(displayName);
  const user = group.users[participantId] || {
    points: 0,
    levelXp: 0,
    messages: 0,
    textMessages: 0,
    mediaMessages: 0,
    stickerMessages: 0,
    achievements: {},
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  user.levelXp = getUserLevelXp(user) + xp;
  ensureUserActivityFields(user);
  if (usefulDisplayName || !getUsefulDisplayName(user.displayName)) {
    user.displayName = usefulDisplayName || safeDisplayName || "Participante";
  }
  user.lastActivityAt = new Date(now).toISOString();
  group.users[participantId] = user;
  group.updatedAt = user.lastActivityAt;
  root.groups[groupId] = group;
  scheduleSave();
  return user;
}

function setLevelXp({ groupId, participantId, displayName, xp, now = Date.now() }) {
  participantId = normalizeParticipantId(participantId);
  xp = Math.max(0, Math.floor(Number(xp) || 0));
  if (!config.rank.enabled || !isGroupJid(groupId) || !participantId) return null;
  if (isGroupJid(participantId)) return null;
  if (!isRankEnabled(groupId)) return null;

  const root = loadStats();
  getRankUserId(participantId);
  const group = root.groups[groupId] || { users: {}, updatedAt: null };
  const safeDisplayName = sanitizeDisplayName(displayName);
  const usefulDisplayName = getUsefulDisplayName(displayName);
  const user = group.users[participantId] || {
    points: 0,
    levelXp: 0,
    messages: 0,
    textMessages: 0,
    mediaMessages: 0,
    stickerMessages: 0,
    achievements: {},
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  user.levelXp = xp;
  ensureUserActivityFields(user);
  if (usefulDisplayName || !getUsefulDisplayName(user.displayName)) {
    user.displayName = usefulDisplayName || safeDisplayName || "Participante";
  }
  user.lastActivityAt = new Date(now).toISOString();
  group.users[participantId] = user;
  group.updatedAt = user.lastActivityAt;
  root.groups[groupId] = group;
  scheduleSave();
  return user;
}

function removeLevelXp({ groupId, participantId, xp }) {
  participantId = normalizeParticipantId(participantId);
  xp = Math.max(0, Math.floor(Number(xp) || 0));
  if (!isGroupJid(groupId) || !participantId || xp <= 0) return { ok: false, reason: "invalid" };

  const root = loadStats();
  const user = root.groups[groupId]?.users?.[participantId];
  if (!user) return { ok: false, reason: "not_found" };

  user.levelXp = Math.max(0, getUserLevelXp(user) - xp);
  scheduleSave();
  return { ok: true, user };
}

function removeRankPoints(participantId, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (amount <= 0) return { ok: false, reason: "invalid_amount" };
  if (!spendRankPoints(participantId, amount)) return { ok: false, reason: "insufficient" };
  return { ok: true, wallet: getUserWallet(participantId) };
}

function getSocialRoot() {
  const root = loadStats();
  if (!root.social) root.social = {};
  if (!root.social.gifts) root.social.gifts = { users: {}, history: [] };
  if (!root.social.gifts.users) root.social.gifts.users = {};
  if (!Array.isArray(root.social.gifts.history)) root.social.gifts.history = [];
  if (!root.social.marriages) root.social.marriages = { groups: {} };
  if (!root.social.marriages.groups) root.social.marriages.groups = {};
  return root.social;
}

function getMarriageGroup(groupId) {
  const social = getSocialRoot();
  social.marriages.groups[groupId] = social.marriages.groups[groupId] || {
    couples: {},
    pending: {},
    cooldowns: {},
  };
  const group = social.marriages.groups[groupId];
  if (!group.couples) group.couples = {};
  if (!group.pending) group.pending = {};
  if (!group.cooldowns) group.cooldowns = {};
  return group;
}

function getGiftDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function sendGift({ groupId, fromId, fromName, toId, toName, amount, message = "", now = Date.now() } = {}) {
  fromId = normalizeParticipantId(fromId);
  toId = normalizeParticipantId(toId);
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!fromId || !toId || isGroupJid(fromId) || isGroupJid(toId)) return { ok: false, reason: "invalid_user" };
  if (fromId === toId) return { ok: false, reason: "self" };
  if (amount < config.social.giftMinPoints) return { ok: false, reason: "min", min: config.social.giftMinPoints };

  const social = getSocialRoot();
  const dayKey = getGiftDayKey(now);
  const giftUser = social.gifts.users[fromId] || { dayKey, sentToday: 0 };
  if (giftUser.dayKey !== dayKey) {
    giftUser.dayKey = dayKey;
    giftUser.sentToday = 0;
  }
  if ((giftUser.sentToday || 0) >= config.social.giftDailyLimit) {
    return { ok: false, reason: "daily_limit", limit: config.social.giftDailyLimit };
  }

  const wallet = getUserWallet(fromId);
  if (wallet.balance < amount) return { ok: false, reason: "insufficient", wallet };
  if (!spendRankPoints(fromId, amount)) return { ok: false, reason: "insufficient", wallet: getUserWallet(fromId) };

  addRankPoints({ groupId, participantId: toId, displayName: toName, points: amount, now });
  giftUser.sentToday = (giftUser.sentToday || 0) + 1;
  social.gifts.users[fromId] = giftUser;
  social.gifts.history.unshift({
    groupId,
    fromId,
    fromName: sanitizeDisplayName(fromName) || "Participante",
    toId,
    toName: sanitizeDisplayName(toName) || "Participante",
    amount,
    message: String(message || "").slice(0, 120),
    at: new Date(now).toISOString(),
  });
  social.gifts.history = social.gifts.history.slice(0, 50);
  scheduleSave();
  return { ok: true, amount, message: String(message || "").trim(), wallet: getUserWallet(fromId) };
}

function getCooldownWaitMs(cooldownUntil, now = Date.now()) {
  const until = cooldownUntil ? Date.parse(cooldownUntil) : 0;
  return Math.max(0, until - now);
}

function hasMarriageCooldown(group, participantId, now = Date.now()) {
  return getCooldownWaitMs(group.cooldowns?.[participantId], now) > 0;
}

function createMarriageProposal({ groupId, fromId, fromName, toId, toName, now = Date.now() } = {}) {
  fromId = normalizeParticipantId(fromId);
  toId = normalizeParticipantId(toId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!fromId || !toId || isGroupJid(fromId) || isGroupJid(toId)) return { ok: false, reason: "invalid_user" };
  if (fromId === toId) return { ok: false, reason: "self" };

  const group = getMarriageGroup(groupId);
  if (group.couples[fromId] || group.couples[toId]) return { ok: false, reason: "already_married" };
  if (hasMarriageCooldown(group, fromId, now)) return { ok: false, reason: "cooldown", waitMs: getCooldownWaitMs(group.cooldowns[fromId], now) };
  if (hasMarriageCooldown(group, toId, now)) return { ok: false, reason: "target_cooldown", waitMs: getCooldownWaitMs(group.cooldowns[toId], now) };

  for (const proposal of Object.values(group.pending)) {
    if ([proposal.fromId, proposal.toId].includes(fromId) || [proposal.fromId, proposal.toId].includes(toId)) {
      if (Date.parse(proposal.expiresAt) > now) return { ok: false, reason: "pending" };
    }
  }

  const proposal = {
    fromId,
    fromName: sanitizeDisplayName(fromName) || "Participante",
    toId,
    toName: sanitizeDisplayName(toName) || "Participante",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.social.marriageProposalTtlMs).toISOString(),
  };
  group.pending[toId] = proposal;
  scheduleSave();
  return { ok: true, proposal };
}

function acceptMarriage({ groupId, participantId, displayName, now = Date.now() } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  const group = getMarriageGroup(groupId);
  const proposal = group.pending[participantId];
  if (!proposal) return { ok: false, reason: "no_proposal" };
  if (Date.parse(proposal.expiresAt) <= now) {
    delete group.pending[participantId];
    scheduleSave();
    return { ok: false, reason: "expired" };
  }
  if (group.couples[proposal.fromId] || group.couples[proposal.toId]) return { ok: false, reason: "already_married" };
  if (hasMarriageCooldown(group, proposal.fromId, now) || hasMarriageCooldown(group, proposal.toId, now)) return { ok: false, reason: "cooldown" };

  const since = new Date(now).toISOString();
  const fromName = proposal.fromName;
  const toName = sanitizeDisplayName(displayName) || proposal.toName;
  group.couples[proposal.fromId] = { partnerId: proposal.toId, partnerName: toName, selfName: fromName, since };
  group.couples[proposal.toId] = { partnerId: proposal.fromId, partnerName: fromName, selfName: toName, since };
  delete group.pending[participantId];
  scheduleSave();
  return { ok: true, fromId: proposal.fromId, fromName, toId: proposal.toId, toName, since };
}

function declineMarriage({ groupId, participantId } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  const group = getMarriageGroup(groupId);
  const proposal = group.pending[participantId];
  if (!proposal) return { ok: false, reason: "no_proposal" };
  delete group.pending[participantId];
  scheduleSave();
  return { ok: true, proposal };
}

function cancelMarriageProposal({ groupId, participantId } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  const group = getMarriageGroup(groupId);
  const entry = Object.entries(group.pending).find(([, proposal]) => proposal.fromId === participantId);
  if (!entry) return { ok: false, reason: "no_proposal" };
  delete group.pending[entry[0]];
  scheduleSave();
  return { ok: true, proposal: entry[1] };
}

function divorceMarriage({ groupId, participantId, now = Date.now() } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  const group = getMarriageGroup(groupId);
  const marriage = group.couples[participantId];
  if (!marriage) return { ok: false, reason: "not_married" };
  const partnerId = marriage.partnerId;
  const partner = group.couples[partnerId];
  const cooldownUntil = new Date(now + config.social.marriageCooldownMs).toISOString();
  group.cooldowns[participantId] = cooldownUntil;
  group.cooldowns[partnerId] = cooldownUntil;
  delete group.couples[participantId];
  delete group.couples[partnerId];
  scheduleSave();
  return { ok: true, partnerId, partnerName: marriage.partnerName || partner?.selfName || "Participante", cooldownUntil };
}

function getMarriage(groupId, participantId) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId) || !participantId) return null;
  return getMarriageGroup(groupId).couples[participantId] || null;
}

function getMarriageDailyBonusRate(groupId, participantId) {
  return getMarriage(groupId, participantId) ? config.social.marriageDailyBonus : 0;
}

function formatMarriageHelp() {
  const bonus = Math.round(config.social.marriageDailyBonus * 100);
  return [
    "💍 *CENTRAL DA ALIANÇA*",
    "",
    "━━ ✦ *CONVITE* ✦ ━━",
    "💌 *.formaralianca @user*",
    "   ↳ envia um convite",
    "",
    "✅ *.aceitaralianca*",
    "   ↳ aceita o convite",
    "",
    "❌ *.recusaralianca*",
    "   ↳ recusa o convite",
    "",
    "🧾 *.cancelaralianca*",
    "   ↳ cancela seu convite",
    "",
    "━━ ✦ *ALIADOS* ✦ ━━",
    "💞 *.minhaalianca*",
    "   ↳ mostra sua aliança",
    "",
    "💔 *.desfazeralianca*",
    "   ↳ encerra a aliança",
    "",
    "━━ ✦ *BÔNUS* ✦ ━━",
    `🎁 Daily +${bonus}% para os dois`,
    "",
    "🏷️ Tags são individuais",
    "   ↳ bônus de tag não passa pro par",
    "",
    "━━ ✦ *REGRAS* ✦ ━━",
    "⏳ Pedido expira em 10 minutos",
    "🔐 Só a pessoa marcada aceita",
    "📍 Vale apenas neste grupo",
    "💔 Desfez: 3 dias sem formar outra aliança",
  ].join("\n");
}

function formatMarriageInfo({ groupId, participantId, displayName, now = Date.now() } = {}) {
  const marriage = getMarriage(groupId, participantId);
  if (!marriage) return "💍 Você não possui uma aliança neste grupo.";
  const since = Date.parse(marriage.since);
  const days = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / (24 * 60 * 60 * 1000))) : 0;
  return [
    "╭━━━❰ 💞 ALIANÇA 💞 ❱━━━╮",
    `┃ ${sanitizeDisplayName(displayName) || "Você"} + ${marriage.partnerName || "Participante"}`,
    `┃ Aliados há: ${days} dia(s)`,
    `┃ Bônus daily: +${Math.round(config.social.marriageDailyBonus * 100)}%`,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function claimDaily({ groupId, participantId, displayName, now = Date.now() }) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!participantId || isGroupJid(participantId)) return { ok: false, reason: "invalid_user" };

  const root = loadStats();
  const dailyUser = root.daily.users[participantId] || {};
  const lastClaimAt = dailyUser.lastClaimAt ? Date.parse(dailyUser.lastClaimAt) : 0;
  const cooldownMs = config.daily.cooldownMs;
  const elapsed = now - lastClaimAt;

  if (lastClaimAt && elapsed < cooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      waitMs: cooldownMs - elapsed,
      lastClaimAt: dailyUser.lastClaimAt,
    };
  }

  const reward = getDailyReward(participantId, groupId);
  addRankPoints({
    groupId,
    participantId,
    displayName,
    points: reward.points,
    now,
  });

  root.daily.users[participantId] = {
    lastClaimAt: new Date(now).toISOString(),
    lastPoints: reward.points,
  };
  scheduleSave();

  return {
    ok: true,
    ...reward,
    nextAt: new Date(now + cooldownMs).toISOString(),
  };
}

function claimRoulette({ groupId, participantId, displayName, now = Date.now(), random = Math.random, ignoreCooldown = false } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!participantId || isGroupJid(participantId)) return { ok: false, reason: "invalid_user" };

  const root = loadStats();
  const rouletteUser = root.roulette.users[participantId] || {};
  const lastClaimAt = rouletteUser.lastClaimAt ? Date.parse(rouletteUser.lastClaimAt) : 0;
  const cooldownMs = config.roulette.cooldownMs;
  const elapsed = now - lastClaimAt;
  let usedExtraSpin = false;

  if (!ignoreCooldown && lastClaimAt && elapsed < cooldownMs) {
    if (consumeExtraSpin(participantId)) {
      usedExtraSpin = true;
    } else {
      return {
        ok: false,
        reason: "cooldown",
        waitMs: cooldownMs - elapsed,
        lastClaimAt: rouletteUser.lastClaimAt,
      };
    }
  }

  const prize = getRoulettePrize(random);
  if (prize.points > 0) {
    addRankPoints({
      groupId,
      participantId,
      displayName,
      points: prize.points,
      now,
    });
  }

  if (!ignoreCooldown && !usedExtraSpin) {
    root.roulette.users[participantId] = {
      lastClaimAt: new Date(now).toISOString(),
      lastPrizeId: prize.id,
      lastPoints: prize.points,
    };
  }
  scheduleSave();

  return {
    ok: true,
    ...prize,
    usedExtraSpin,
    nextAt: new Date(now + cooldownMs).toISOString(),
  };
}

function claimTurboRedeem({ groupId, participantId, displayName, now = Date.now(), random = Math.random } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!participantId || isGroupJid(participantId)) return { ok: false, reason: "invalid_user" };
  if (!hasBenefit(participantId, "resgate")) return { ok: false, reason: "no_benefit" };

  const daily = claimDaily({ groupId, participantId, displayName, now });
  const roulette = claimRoulette({ groupId, participantId, displayName, now, random });

  return {
    ok: !!(daily.ok || roulette.ok),
    daily,
    roulette,
  };
}

function getRoulettePrize(random = Math.random) {
  const prizes = Array.isArray(config.roulette?.prizes) ? config.roulette.prizes : [];
  const validPrizes = prizes
    .map((prize) => ({
      id: String(prize.id),
      points: Math.max(0, Math.floor(Number(prize.points) || 0)),
      weight: Math.max(0, Number(prize.weight) || 0),
    }))
    .filter((prize) => prize.id && prize.weight > 0);

  if (!validPrizes.length) return { id: "0", points: 0 };

  const totalWeight = validPrizes.reduce((total, prize) => total + prize.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * totalWeight;

  for (const prize of validPrizes) {
    cursor -= prize.weight;
    if (cursor < 0) return { id: prize.id, points: prize.points };
  }

  const fallback = validPrizes[validPrizes.length - 1];
  return { id: fallback.id, points: fallback.points };
}

function openMysteryBox({ groupId, participantId, displayName, now = Date.now(), random = Math.random } = {}) {
  participantId = normalizeParticipantId(participantId);
  if (!isGroupJid(groupId)) return { ok: false, reason: "not_group" };
  if (!isRankEnabled(groupId)) return { ok: false, reason: "rank_disabled" };
  if (!participantId || isGroupJid(participantId)) return { ok: false, reason: "invalid_user" };

  const user = getShopUser(participantId);
  if (user.boxes.mystery <= 0) return { ok: false, reason: "no_box" };

  const prize = getMysteryBoxPrize(random);
  user.boxes.mystery -= 1;

  if (prize.type === "points" && prize.points > 0) {
    addRankPoints({ groupId, participantId, displayName, points: prize.points, now });
  } else if (prize.type === "item" && prize.item === "extraSpin") {
    user.items.extraSpin += prize.amount || 1;
  } else if (prize.type === "boost" && prize.item === "pointMagnet") {
    const currentUntil = user.items.pointMagnetUntil ? Date.parse(user.items.pointMagnetUntil) : 0;
    const base = Number.isFinite(currentUntil) && currentUntil > now ? currentUntil : now;
    user.items.pointMagnetUntil = new Date(base + prize.durationMs).toISOString();
  }

  scheduleSave();
  return { ok: true, prize, inventory: getInventory(participantId), wallet: getUserWallet(participantId) };
}

function getMysteryBoxPrize(random = Math.random) {
  const prizes = Array.isArray(config.shop.mysteryBox?.prizes) ? config.shop.mysteryBox.prizes : [];
  const validPrizes = prizes
    .map((prize) => ({ ...prize, weight: Math.max(0, Number(prize.weight) || 0) }))
    .filter((prize) => prize.id && prize.weight > 0);
  if (!validPrizes.length) return { id: "points_50", type: "points", points: 50, name: "+50 pontos", weight: 1 };

  const totalWeight = validPrizes.reduce((total, prize) => total + prize.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * totalWeight;
  for (const prize of validPrizes) {
    cursor -= prize.weight;
    if (cursor < 0) return prize;
  }
  return validPrizes[validPrizes.length - 1];
}

function consumeExtraSpin(participantId) {
  const user = getShopUser(participantId);
  if (user.items.extraSpin <= 0) return false;
  user.items.extraSpin -= 1;
  scheduleSave();
  return true;
}

function getPointMagnetBonus(participantId, now = Date.now()) {
  const user = getShopUser(participantId);
  const activeUntil = user.items.pointMagnetUntil ? Date.parse(user.items.pointMagnetUntil) : 0;
  if (!Number.isFinite(activeUntil) || activeUntil <= now) return 0;
  return 1;
}

function getInventory(participantId, now = Date.now()) {
  const user = getShopUser(participantId);
  const activeUntil = user.items.pointMagnetUntil ? Date.parse(user.items.pointMagnetUntil) : 0;
  return {
    boxes: { mystery: user.boxes.mystery },
    items: {
      extraSpin: user.items.extraSpin,
      pointMagnetUntil: user.items.pointMagnetUntil,
      pointMagnetActive: Number.isFinite(activeUntil) && activeUntil > now,
      pointMagnetMs: Number.isFinite(activeUntil) ? Math.max(0, activeUntil - now) : 0,
    },
    benefits: [...user.benefits],
  };
}

function getDailyReward(participantId, groupId = "") {
  const basePoints = config.daily.basePoints;
  const tag = getEquippedTag(participantId);
  const tagBonusRate = tag ? getTagDailyBonusRate(tag) : 0;
  const marriageBonusRate = getMarriageDailyBonusRate(groupId, participantId);
  const bonusRate = tagBonusRate + marriageBonusRate;
  const bonusPoints = Math.floor(basePoints * bonusRate);

  return {
    basePoints,
    bonusRate,
    tagBonusRate,
    marriageBonusRate,
    bonusPoints,
    points: basePoints + bonusPoints,
    tag,
    marriage: getMarriage(groupId, participantId),
  };
}

function getTagDailyBonusRate(tag = {}) {
  return Number.isFinite(tag.dailyBonus)
    ? tag.dailyBonus
    : (config.daily.rarityBonus[tag.rarity] || 0);
}

function findParticipantsByDisplayName(normalizedName) {
  const merged = new Map();
  const root = loadStats();

  for (const [groupId, group] of Object.entries(root.groups || {})) {
    if (!root.enabledGroups[groupId]) continue;

    for (const [rawParticipantId, user] of Object.entries(group.users || {})) {
      const participantId = normalizeParticipantId(rawParticipantId);
      if (!participantId || isGroupJid(participantId)) continue;
      if (normalizeName(getSafeDisplayName(user)) !== normalizedName) continue;

      const current = merged.get(participantId) || { participantId, points: 0, messages: 0 };
      current.points += user.points || 0;
      current.messages += user.messages || 0;
      merged.set(participantId, current);
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.messages - a.messages;
  });
}

function resetGlobalRank() {
  const root = loadStats();
  const groupIds = new Set([
    ...Object.keys(root.groups || {}),
    ...Object.keys(root.enabledGroups || {}),
  ]);

  for (const groupId of groupIds) {
    root.groups[groupId] = { users: {}, updatedAt: null };
  }

  lastScoredAt.clear();
  scheduleSave();
}

function resetGroupRank(groupId) {
  if (!isGroupJid(groupId)) return false;

  const root = loadStats();
  root.groups[groupId] = { users: {}, updatedAt: null };

  for (const key of lastScoredAt.keys()) {
    if (key.startsWith(`${groupId}:`)) lastScoredAt.delete(key);
  }

  scheduleSave();
  return true;
}

function resetGroupLevel(groupId) {
  if (!isGroupJid(groupId)) return false;

  const root = loadStats();
  const group = root.groups[groupId];
  if (!group?.users) return true;

  for (const user of Object.values(group.users)) {
    user.levelXp = 0;
  }

  for (const key of lastScoredAt.keys()) {
    if (key.startsWith(`${groupId}:`)) lastScoredAt.delete(key);
  }

  group.updatedAt = new Date().toISOString();
  scheduleSave();
  return true;
}

function removeUserFromGroupByName(groupId, query = "") {
  if (!isGroupJid(groupId)) return { removed: [], matches: [] };

  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return { removed: [], matches: [] };

  const root = loadStats();
  const group = root.groups[groupId];
  if (!group?.users) return { removed: [], matches: [] };

  const users = Object.entries(group.users)
    .filter(([participantId]) => !isGroupJid(participantId))
    .map(([participantId, user]) => ({
      participantId,
      user,
      normalizedName: normalizeName(getSafeDisplayName(user)),
    }))
    .filter((item) => item.normalizedName);

  const exactMatches = users.filter((item) => item.normalizedName === normalizedQuery);
  const matches = exactMatches.length
    ? exactMatches
    : users.filter((item) => item.normalizedName.includes(normalizedQuery));

  const removed = [];
  for (const item of matches) {
    delete group.users[item.participantId];
    removed.push({ participantId: item.participantId, ...item.user });
  }

  if (removed.length) {
    group.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  return { removed, matches };
}

function removeUserGlobally(query = "") {
  const normalizedQuery = normalizeName(query);
  const normalizedIdQuery = normalizeRankIdQuery(query);
  if (!normalizedQuery) return { removed: [], matches: [] };

  const root = loadStats();
  const removed = [];
  const matches = [];
  const removedParticipantIds = new Set();

  for (const [groupId, group] of Object.entries(root.groups || {})) {
    if (!group?.users) continue;

    const users = Object.entries(group.users)
      .map(([rawParticipantId, user]) => ({
        groupId,
        participantId: normalizeParticipantId(rawParticipantId),
        rawParticipantId,
        user,
        rankId: getRankUserId(rawParticipantId),
        normalizedName: normalizeName(getSafeDisplayName(user)),
      }))
      .filter((item) => item.participantId && !isGroupJid(item.participantId));

    const groupMatches = users.filter((item) => {
      if (item.rankId === normalizedIdQuery) return true;
      if (!item.normalizedName) return false;
      return item.normalizedName === normalizedQuery || item.normalizedName.includes(normalizedQuery);
    });

    for (const item of groupMatches) {
      matches.push(item);
      delete group.users[item.rawParticipantId];
      delete group.users[item.participantId];
      removed.push({
        groupId,
        participantId: item.participantId,
        rankId: item.rankId,
        ...item.user,
      });
      removedParticipantIds.add(item.participantId);
    }

    if (groupMatches.length) {
      group.updatedAt = new Date().toISOString();
    }
  }

  if (removed.length) {
    for (const key of lastScoredAt.keys()) {
      const participantId = key.split(":").slice(1).join(":");
      if (removedParticipantIds.has(participantId)) lastScoredAt.delete(key);
    }

    scheduleSave();
  }

  return { removed, matches };
}

function findParticipantId(query = "") {
  const normalizedQuery = normalizeName(query);
  const normalizedIdQuery = normalizeRankIdQuery(query);
  if (!normalizedQuery) return "";

  const root = loadStats();
  const directId = normalizeParticipantId(query);
  if (directId && !isGroupJid(directId)) {
    if (getGlobalUserStats(directId) || root.shop.users?.[directId] || root.rankIds?.[directId]) return directId;
  }

  for (const [participantId, rankId] of Object.entries(root.rankIds || {})) {
    const normalizedParticipantId = normalizeParticipantId(participantId);
    if (formatRankId(rankId) === normalizedIdQuery && normalizedParticipantId) return normalizedParticipantId;
  }

  const candidates = [];
  for (const group of Object.values(root.groups || {})) {
    for (const [rawParticipantId, user] of Object.entries(group?.users || {})) {
      const participantId = normalizeParticipantId(rawParticipantId);
      const normalizedName = normalizeName(getSafeDisplayName(user));
      if (!participantId || isGroupJid(participantId) || !normalizedName) continue;
      if (normalizedName === normalizedQuery) candidates.unshift(participantId);
      else if (normalizedName.includes(normalizedQuery)) candidates.push(participantId);
    }
  }

  return candidates[0] || "";
}

function getUserPosition(groupId, participantId) {
  if (!isRankEnabled(groupId)) return null;
  const ranked = rankGroup(groupId, Number.MAX_SAFE_INTEGER);
  const index = ranked.findIndex((item) => item.participantId === participantId);
  if (index === -1) return null;
  return { position: index + 1, user: ranked[index] };
}

function getLevelPosition(groupId, participantId) {
  if (!isRankEnabled(groupId)) return null;
  const ranked = rankLevelGroup(groupId, Number.MAX_SAFE_INTEGER);
  const index = ranked.findIndex((item) => item.participantId === participantId);
  if (index === -1) return null;
  return { position: index + 1, user: ranked[index] };
}

function sortUsers(users = {}) {
  return Object.entries(users)
    .map(([participantId, user]) => ({ participantId: normalizeParticipantId(participantId), ...user }))
    .filter((item) => item.participantId && !isGroupJid(item.participantId))
    .sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
      return (b.messages || 0) - (a.messages || 0);
    });
}

function sortUsersByLevel(users = {}) {
  return sortUsers(users)
    .map((user) => ({ ...user, levelInfo: getLevelInfo(getUserLevelXp(user)) }))
    .sort((a, b) => {
      if (b.levelInfo.level !== a.levelInfo.level) return b.levelInfo.level - a.levelInfo.level;
      if (b.levelInfo.totalXp !== a.levelInfo.totalXp) return b.levelInfo.totalXp - a.levelInfo.totalXp;
      return (b.messages || 0) - (a.messages || 0);
    });
}

function rankLevelGroup(groupId, limit = config.rank.levelTopLimit) {
  if (!isRankEnabled(groupId)) return [];
  const group = loadStats().groups[groupId];
  if (!group) return [];
  return sortUsersByLevel(group.users).slice(0, limit);
}

function getShopUser(participantId) {
  participantId = normalizeParticipantId(participantId);
  const root = loadStats();
  if (!root.shop) root.shop = { users: {} };
  if (!root.shop.users) root.shop.users = {};

  root.shop.users[participantId] = root.shop.users[participantId] || {
    ownedTags: [],
    ownedProfileThemes: [],
    benefits: [],
    items: {},
    boxes: {},
    boxPurchases: {},
    equippedTag: null,
    profileTheme: null,
    spent: 0,
  };

  normalizeShopUser(root.shop.users[participantId]);

  return root.shop.users[participantId];
}

function normalizeShopUser(user = {}) {
  if (!Array.isArray(user.ownedTags)) user.ownedTags = [];
  if (!Array.isArray(user.ownedProfileThemes)) user.ownedProfileThemes = [];
  if (!Array.isArray(user.benefits)) user.benefits = [];
  if (!user.items || typeof user.items !== "object") user.items = {};
  if (!user.boxes || typeof user.boxes !== "object") user.boxes = {};
  if (!user.boxPurchases || typeof user.boxPurchases !== "object") user.boxPurchases = {};
  user.items.extraSpin = Math.max(0, Math.floor(Number(user.items.extraSpin) || 0));
  user.items.pointMagnetUntil = user.items.pointMagnetUntil || null;
  user.boxes.mystery = Math.max(0, Math.floor(Number(user.boxes.mystery) || 0));
  user.spent = Math.max(0, Math.floor(Number(user.spent) || 0));
  return user;
}

function migrateShopInventory(root = loadStats()) {
  if (!root.shop) root.shop = { users: {} };
  if (!root.shop.users) root.shop.users = {};
  let changed = false;

  for (const user of Object.values(root.shop.users)) {
    normalizeShopUser(user);
  }

  if (!root.shop.updateGiftMysteryBoxV1) {
    const participantIds = new Set(Object.keys(root.shop.users));
    for (const group of Object.values(root.groups || {})) {
      for (const participantId of Object.keys(group.users || {})) {
        const normalizedId = normalizeParticipantId(participantId);
        if (normalizedId && !isGroupJid(normalizedId)) participantIds.add(normalizedId);
      }
    }

    for (const participantId of participantIds) {
      root.shop.users[participantId] = normalizeShopUser(root.shop.users[participantId] || {});
      root.shop.users[participantId].boxes.mystery += 1;
    }

    root.shop.updateGiftMysteryBoxV1 = {
      grantedAt: new Date().toISOString(),
      count: participantIds.size,
    };
    changed = true;
  }

  return changed;
}

function mergeShopParticipant(fromParticipantId, toParticipantId) {
  fromParticipantId = normalizeParticipantId(fromParticipantId);
  toParticipantId = normalizeParticipantId(toParticipantId);
  if (!fromParticipantId || !toParticipantId || fromParticipantId === toParticipantId) return false;

  const root = loadStats();
  const from = root.shop?.users?.[fromParticipantId];
  if (!from) return false;

  root.shop.users[toParticipantId] = mergeShopUsers(root.shop.users[toParticipantId], from);
  delete root.shop.users[fromParticipantId];
  scheduleSave();
  return true;
}

function getTagByQuery(query = "") {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return null;

  return config.shop.tags.find((tag) => {
    const normalizedId = normalizeName(tag.id);
    const normalizedName = normalizeName(tag.name);
    return normalizedId === normalizedQuery ||
      normalizedName === normalizedQuery ||
      normalizedName.includes(normalizedQuery);
  }) || null;
}

function getTagById(tagId = "") {
  return config.shop.tags.find((tag) => tag.id === tagId) || null;
}

function getBenefitByQuery(query = "") {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return null;

  return (config.shop.benefits || []).find((benefit) => {
    const names = [benefit.id, benefit.name, ...(benefit.aliases || [])].map(normalizeName);
    return names.includes(normalizedQuery) || names.some((name) => name.includes(normalizedQuery));
  }) || null;
}

function getBenefitById(benefitId = "") {
  return (config.shop.benefits || []).find((benefit) => benefit.id === benefitId) || null;
}

function hasBenefit(participantId, benefitId) {
  return getShopUser(participantId).benefits.includes(benefitId);
}

function buyBenefit(participantId, query = "", now = Date.now()) {
  participantId = normalizeParticipantId(participantId);
  const benefit = getBenefitByQuery(query);
  if (!benefit) return { ok: false, reason: "not_found" };

  const user = getShopUser(participantId);
  const wallet = getUserWallet(participantId);

  if (benefit.type === "permanent" && user.benefits.includes(benefit.id)) {
    return { ok: false, reason: "already_owned", benefit, wallet };
  }

  if (benefit.type === "box") {
    const dateKey = getDateKey(now);
    const todayCount = Math.max(0, Math.floor(Number(user.boxPurchases[dateKey]) || 0));
    const limit = benefit.dailyLimit || config.shop.mysteryBox?.dailyLimit || 3;
    if (todayCount >= limit) {
      return { ok: false, reason: "daily_limit", benefit, limit, wallet };
    }
  }

  if (wallet.balance < benefit.price) {
    return { ok: false, reason: "insufficient", benefit, wallet };
  }

  if (benefit.price > 0 && !spendRankPoints(participantId, benefit.price)) {
    return { ok: false, reason: "insufficient", benefit, wallet: getUserWallet(participantId) };
  }

  if (benefit.type === "box") {
    const dateKey = getDateKey(now);
    user.boxes.mystery += 1;
    user.boxPurchases[dateKey] = Math.max(0, Math.floor(Number(user.boxPurchases[dateKey]) || 0)) + 1;
  } else if (!user.benefits.includes(benefit.id)) {
    user.benefits.push(benefit.id);
  }

  user.spent += benefit.price;
  scheduleSave();
  return { ok: true, benefit, wallet: getUserWallet(participantId) };
}

function getProfileThemeByQuery(query = "") {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return null;

  return config.profileThemes.find((theme) => {
    const normalizedId = normalizeName(theme.id);
    const normalizedName = normalizeName(theme.name);
    return normalizedId === normalizedQuery ||
      normalizedName === normalizedQuery ||
      normalizedName.includes(normalizedQuery);
  }) || null;
}

function getProfileThemeById(themeId = "") {
  return config.profileThemes.find((theme) => theme.id === themeId) || null;
}

function getUserWallet(participantId) {
  participantId = normalizeParticipantId(participantId);
  const global = getGlobalUserStats(participantId);
  const totalPoints = global?.points || 0;
  return {
    totalPoints,
    balance: totalPoints,
  };
}

function buyTag(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const tag = getTagByQuery(query);
  if (!tag) return { ok: false, reason: "not_found" };
  if (tag.locked && !options.allowLocked) return { ok: false, reason: "locked", tag };

  const user = getShopUser(participantId);
  if (user.ownedTags.includes(tag.id)) {
    return { ok: false, reason: "already_owned", tag, wallet: getUserWallet(participantId) };
  }

  const wallet = getUserWallet(participantId);
  if (wallet.balance < tag.price) {
    return { ok: false, reason: "insufficient", tag, wallet };
  }

  if (tag.price > 0 && !spendRankPoints(participantId, tag.price)) {
    return { ok: false, reason: "insufficient", tag, wallet: getUserWallet(participantId) };
  }

  user.ownedTags.push(tag.id);
  if (!user.equippedTag) user.equippedTag = tag.id;
  scheduleSave();
  return { ok: true, tag, wallet: getUserWallet(participantId) };
}

function buyShopItem(participantId, query = "", options = {}) {
  const tag = getTagByQuery(query);
  if (tag) return { ...buyTag(participantId, query, options), kind: "tag" };

  const benefit = getBenefitByQuery(query);
  if (benefit) return { ...buyBenefit(participantId, query, options.now), kind: "benefit" };

  return { ok: false, reason: "not_found" };
}

function grantTag(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const tag = getTagByQuery(query);
  if (!tag) return { ok: false, reason: "not_found" };
  if (tag.locked && !options.allowLocked) return { ok: false, reason: "locked", tag };

  const user = getShopUser(participantId);
  if (!user.ownedTags.includes(tag.id)) {
    user.ownedTags.push(tag.id);
  }
  if (options.equip) user.equippedTag = tag.id;
  scheduleSave();
  return { ok: true, tag };
}

function revokeTag(participantId, query = "") {
  participantId = normalizeParticipantId(participantId);
  const user = getShopUser(participantId);
  const normalizedQuery = normalizeName(query);
  if (["todas", "todos", "all"].includes(normalizedQuery)) {
    user.ownedTags = [];
    user.equippedTag = null;
    scheduleSave();
    return { ok: true, all: true };
  }

  const tag = getTagByQuery(query);
  if (!tag) return { ok: false, reason: "not_found" };

  user.ownedTags = user.ownedTags.filter((tagId) => tagId !== tag.id);
  if (user.equippedTag === tag.id) user.equippedTag = null;
  scheduleSave();
  return { ok: true, tag };
}

function buyProfileTheme(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const theme = getProfileThemeByQuery(query);
  if (!theme) return { ok: false, reason: "not_found" };
  if (theme.locked && !options.allowLocked) return { ok: false, reason: "locked", theme };

  const user = getShopUser(participantId);
  if (user.ownedProfileThemes.includes(theme.id)) {
    return { ok: false, reason: "already_owned", theme, wallet: getUserWallet(participantId) };
  }

  const wallet = getUserWallet(participantId);
  if (wallet.balance < theme.price) {
    return { ok: false, reason: "insufficient", theme, wallet };
  }

  if (theme.price > 0 && !spendRankPoints(participantId, theme.price)) {
    return { ok: false, reason: "insufficient", theme, wallet: getUserWallet(participantId) };
  }

  user.ownedProfileThemes.push(theme.id);
  if (!user.profileTheme) user.profileTheme = theme.id;
  scheduleSave();
  return { ok: true, theme, wallet: getUserWallet(participantId) };
}

function grantProfileTheme(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const theme = getProfileThemeByQuery(query);
  if (!theme) return { ok: false, reason: "not_found" };
  if (theme.locked && !options.allowLocked) return { ok: false, reason: "locked", theme };

  const user = getShopUser(participantId);
  if (!user.ownedProfileThemes.includes(theme.id)) {
    user.ownedProfileThemes.push(theme.id);
  }
  if (options.equip) user.profileTheme = theme.id;
  scheduleSave();
  return { ok: true, theme };
}

function revokeProfileTheme(participantId, query = "") {
  participantId = normalizeParticipantId(participantId);
  const user = getShopUser(participantId);
  const normalizedQuery = normalizeName(query);
  if (["todos", "todas", "all"].includes(normalizedQuery)) {
    user.ownedProfileThemes = [];
    user.profileTheme = null;
    scheduleSave();
    return { ok: true, all: true };
  }

  const theme = getProfileThemeByQuery(query);
  if (!theme) return { ok: false, reason: "not_found" };

  user.ownedProfileThemes = user.ownedProfileThemes.filter((themeId) => themeId !== theme.id);
  if (user.profileTheme === theme.id) user.profileTheme = null;
  scheduleSave();
  return { ok: true, theme };
}

function spendRankPoints(participantId, amount) {
  participantId = normalizeParticipantId(participantId);
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!participantId || isGroupJid(participantId) || amount <= 0) return true;

  const wallet = getUserWallet(participantId);
  if (wallet.balance < amount) return false;

  const root = loadStats();
  let remaining = amount;
  const entries = Object.entries(root.groups || {})
    .filter(([groupId]) => root.enabledGroups[groupId])
    .map(([groupId, group]) => ({
      groupId,
      group,
      user: group.users?.[participantId],
    }))
    .filter((item) => item.user && (item.user.points || 0) > 0)
    .sort((a, b) => (b.user.points || 0) - (a.user.points || 0));

  for (const item of entries) {
    if (remaining <= 0) break;
    const available = item.user.points || 0;
    const debit = Math.min(available, remaining);
    item.user.points = available - debit;
    item.group.updatedAt = new Date().toISOString();
    remaining -= debit;
  }

  if (remaining > 0) return false;
  scheduleSave();
  return true;
}

function equipTag(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const tag = getTagByQuery(query);
  if (!tag) return { ok: false, reason: "not_found" };
  if (tag.locked && !options.allowLocked) return { ok: false, reason: "locked", tag };

  const user = getShopUser(participantId);
  if (!user.ownedTags.includes(tag.id)) return { ok: false, reason: "not_owned", tag };

  user.equippedTag = tag.id;
  scheduleSave();
  return { ok: true, tag };
}

function unequipTag(participantId) {
  const user = getShopUser(participantId);
  user.equippedTag = null;
  scheduleSave();
  return true;
}

function getEquippedTag(participantId) {
  const user = getShopUser(participantId);
  return user.equippedTag ? getTagById(user.equippedTag) : null;
}

function getOwnedTags(participantId) {
  const user = getShopUser(participantId);
  return user.ownedTags.map(getTagById).filter(Boolean);
}

function getOwnedProfileThemes(participantId) {
  const user = getShopUser(participantId);
  return user.ownedProfileThemes.map(getProfileThemeById).filter(Boolean);
}

function getEquippedProfileTheme(participantId) {
  const user = getShopUser(participantId);
  return user.profileTheme ? getProfileThemeById(user.profileTheme) : null;
}

function equipProfileTheme(participantId, query = "", options = {}) {
  participantId = normalizeParticipantId(participantId);
  const theme = getProfileThemeByQuery(query);
  if (!theme) return { ok: false, reason: "not_found" };
  if (theme.locked && !options.allowLocked) return { ok: false, reason: "locked", theme };

  const user = getShopUser(participantId);
  if (!user.ownedProfileThemes.includes(theme.id)) return { ok: false, reason: "not_owned", theme };

  user.profileTheme = theme.id;
  scheduleSave();
  return { ok: true, theme };
}

function formatDisplayNameWithTag(user = {}) {
  const tag = getEquippedTag(user.participantId);
  return `${tag ? `[ ${tag.name} ] ` : ""}${getSafeDisplayName(user)}`;
}

function formatShop(participantId) {
  const wallet = getUserWallet(participantId);
  const grouped = groupTagsByRarity(config.shop.tags.filter((tag) => !tag.hiddenFromShop));
  const lines = [
    "╭━━━❰ 🛒 LOJA 🛒 ❱━━━╮",
    `┃ 💰 Seu saldo: *${wallet.balance} pts*`,
    "┃",
    "┃ Compre tags para aparecer no rank",
    "┃ e ganhar bônus no .daily:",
    "",
  ];

  for (const [rarity, tags] of Object.entries(grouped)) {
    lines.push(`┣━ ✦ ${getRarityIcon(rarity)} *${rarity.toUpperCase()}*`);
    for (const tag of tags) {
      const dailyBonus = formatDailyBonus(tag);
      if (tag.locked) {
        lines.push(`┃ 🔒 { ${tag.name} }`);
        lines.push(`┃    bloqueada • daily ${dailyBonus}`);
      } else {
        lines.push(`┃ ${tag.name}`);
        lines.push(`┃    ${tag.price} pts • daily ${dailyBonus} • .comprar ${tag.id}`);
      }
    }
    lines.push("┃");
  }

  lines.push("┣━ ✦ 🎁 *BENEFÍCIOS*");
  for (const benefit of config.shop.benefits || []) {
    if (benefit.hiddenFromShop) continue;
    const suffix = benefit.id === "caixa"
      ? `limite ${benefit.dailyLimit || config.shop.mysteryBox?.dailyLimit || 3}/dia`
      : benefit.type === "permanent"
        ? "permanente"
        : "item";
    lines.push(`┃ ${benefit.name}`);
    lines.push(`┃    ${benefit.price} pts • ${suffix} • .comprar ${benefit.id}`);
  }
  lines.push("┃");
  lines.push("┣━ ✦ COMANDOS");
  lines.push("┃ .comprar <tag>  — compra");
  lines.push("┃ .comprar caixa  — compra caixa");
  lines.push("┃ .inventario     — seus itens");
  lines.push("┃ .abrircaixa     — abre caixa");
  lines.push("┃ .caixa          — chances");
  lines.push("┃ .usartag <tag>  — equipa");
  lines.push("┃ .minhastags     — mochila");
  lines.push("┃ .removertag     — remove");
  lines.push("╰━━━━━━━━━━━━━━━━━━━━━━╯");
  return lines.join("\n").trim();
}

function formatInventory(participantId, now = Date.now()) {
  const wallet = getUserWallet(participantId);
  const inventory = getInventory(participantId, now);
  const benefitNames = inventory.benefits
    .map((id) => getBenefitById(id)?.name)
    .filter(Boolean);
  const magnetText = inventory.items.pointMagnetActive
    ? `ativo por ${formatShortDuration(inventory.items.pointMagnetMs)}`
    : "inativo";

  return [
    "╭━━━❰ 🎒 INVENTÁRIO 🎒 ❱━━━╮",
    `┃ 💰 Saldo: *${wallet.balance} pts*`,
    "┃",
    "┣━ ✦ 📦 *CAIXAS*",
    `┃ Misteriosa: ${inventory.boxes.mystery}`,
    "┃",
    "┣━ ✦ 🎁 *ITENS*",
    `┃ 🎰 Giro Extra: ${inventory.items.extraSpin}`,
    `┃ 🧲 Imã de Pontos: ${magnetText}`,
    "┃",
    "┣━ ✦ 🎟️ *BENEFÍCIOS*",
    ...(benefitNames.length ? benefitNames.map((name) => `┃ ${name}`) : ["┃ Nenhum benefício ativo"]),
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function formatMysteryBoxInfo() {
  const box = getBenefitById("caixa");
  const totalWeight = (config.shop.mysteryBox?.prizes || []).reduce((total, prize) => total + (Number(prize.weight) || 0), 0) || 1;
  const lines = [
    "╭━━━❰ 📦 CAIXA MISTERIOSA 📦 ❱━━━╮",
    `┃ Preço: ${box?.price || 300} pts`,
    `┃ Limite: ${box?.dailyLimit || config.shop.mysteryBox?.dailyLimit || 3} por dia`,
    "┃",
    "┣━ ✦ PRÊMIOS",
  ];

  for (const prize of config.shop.mysteryBox?.prizes || []) {
    const percent = Math.round((Number(prize.weight) || 0) / totalWeight * 100);
    lines.push(`┃ ${prize.name} — ${percent}%`);
  }

  lines.push("┃");
  lines.push("┃ .comprar caixa  — compra");
  lines.push("┃ .abrircaixa     — abre");
  lines.push("╰━━━━━━━━━━━━━━━━━━━━━━╯");
  return lines.join("\n");
}

function formatProfileThemeShop(participantId) {
  const wallet = getUserWallet(participantId);
  const owned = new Set(getShopUser(participantId).ownedProfileThemes || []);
  const equipped = getEquippedProfileTheme(participantId);
  const lines = [
    "╭━━━❰ 🎨 TEMAS DO PERFIL 🎨 ❱━━━╮",
    `┃ 💰 Seu saldo: *${wallet.balance} pts*`,
    "┃",
  ];

  for (const theme of config.profileThemes) {
    const marker = equipped?.id === theme.id ? "✅" : owned.has(theme.id) ? "🎒" : "▫️";
    if (theme.locked) {
      lines.push(`┃ 🔒 ${theme.name}`);
      lines.push(`┃    bloqueado`);
    } else {
      lines.push(`┃ ${marker} ${theme.name}`);
      lines.push(`┃    ${theme.price} pts • .perfil comprar ${theme.id}`);
    }
  }

  lines.push("┃");
  lines.push("┃ .perfil tema <id> — equipa");
  lines.push("╰━━━━━━━━━━━━━━━━━━━━━━╯");
  return lines.join("\n");
}

function formatDailyBonus(tag = {}) {
  const bonus = getTagDailyBonusRate(tag);
  return `+${Math.round(bonus * 100)}%`;
}

function getRarityIcon(rarity = "") {
  return {
    Comum: "🌱",
    Rara: "🔷",
    Épica: "🟣",
    Lendária: "🌟",
    Exclusiva: "🔒",
  }[rarity] || "🏷️";
}

function groupTagsByRarity(tags = []) {
  return tags.reduce((groups, tag) => {
    groups[tag.rarity] = groups[tag.rarity] || [];
    groups[tag.rarity].push(tag);
    return groups;
  }, {});
}

function formatOwnedTags(participantId) {
  const tags = getOwnedTags(participantId);
  const equipped = getEquippedTag(participantId);
  const wallet = getUserWallet(participantId);

  if (!tags.length) {
    return `╭━━━❰ 🎒 MINHAS TAGS 🎒 ❱━━━╮\n┃ Você ainda não comprou tags.\n┃ Saldo: ${wallet.balance} pts\n┃ Use .loja para ver a loja.\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;
  }

  const lines = tags.map((tag) => {
    const marker = equipped?.id === tag.id ? "✅" : "▫️";
    return `┃ ${marker} { ${tag.name} } (${tag.rarity})\n┃    .usartag ${tag.id}`;
  });

  return [
    "╭━━━❰ 🎒 MINHAS TAGS 🎒 ❱━━━╮",
    `┃ 💰 Saldo: *${wallet.balance} pts*`,
    "┃",
    lines.join("\n"),
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

function normalizeName(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getDateKey(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatShortDuration(ms = 0) {
  ms = Math.max(0, Math.floor(Number(ms) || 0));
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours && minutes) return `${hours}h${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatRankId(value) {
  return String(Number(value) || 0).padStart(2, "0");
}

function getNextRankId(rankIds = {}) {
  const values = Object.values(rankIds)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  return values.length ? Math.max(...values) + 1 : 1;
}

function normalizeRankIdQuery(value = "") {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return normalizeName(text);
  return formatRankId(text);
}

function normalizeParticipantId(participantId = "") {
  const text = String(participantId || "").trim();
  if (!text || !text.includes("@")) return text;

  const [rawUser, server] = text.split("@");
  const user = rawUser.split(":")[0];

  if (/^\d+$/.test(user)) {
    return `${user}@s.whatsapp.net`;
  }

  return `${user}@${server}`;
}

function migrateParticipantIds(root) {
  const movedRankIds = {};
  let changed = false;

  for (const [participantId, rankId] of Object.entries(root.rankIds || {})) {
    const normalizedId = normalizeParticipantId(participantId);
    if (!normalizedId || normalizedId === participantId) continue;

    root.rankIds[normalizedId] = root.rankIds[normalizedId] || rankId;
    movedRankIds[participantId] = true;
    changed = true;
  }

  for (const participantId of Object.keys(movedRankIds)) {
    delete root.rankIds[participantId];
  }

  for (const group of Object.values(root.groups || {})) {
    if (!group?.users) continue;

    for (const [participantId, user] of Object.entries({ ...group.users })) {
      const normalizedId = normalizeParticipantId(participantId);
      if (!normalizedId || normalizedId === participantId) continue;

      group.users[normalizedId] = mergeUsers(group.users[normalizedId], user);
      delete group.users[participantId];
      changed = true;
    }
  }

  for (const [participantId, user] of Object.entries({ ...(root.shop?.users || {}) })) {
    const normalizedId = normalizeParticipantId(participantId);
    if (!normalizedId || normalizedId === participantId) continue;

    root.shop.users[normalizedId] = mergeShopUsers(root.shop.users[normalizedId], user);
    delete root.shop.users[participantId];
    changed = true;
  }

  return changed;
}

function mergeUsers(target, source) {
  if (!target) return source;
  if (!source) return target;

  return {
    points: (target.points || 0) + (source.points || 0),
    messages: (target.messages || 0) + (source.messages || 0),
    displayName: getUsefulDisplayName(source.displayName)
      ? source.displayName
      : target.displayName || source.displayName,
    lastActivityAt: maxDate(target.lastActivityAt, source.lastActivityAt),
  };
}

function mergeShopUsers(target, source) {
  if (!target) return source;
  if (!source) return target;
  target = normalizeShopUser(target);
  source = normalizeShopUser(source);

  return {
    ownedTags: [...new Set([...(target.ownedTags || []), ...(source.ownedTags || [])])],
    ownedProfileThemes: [...new Set([...(target.ownedProfileThemes || []), ...(source.ownedProfileThemes || [])])],
    benefits: [...new Set([...(target.benefits || []), ...(source.benefits || [])])],
    items: {
      extraSpin: (target.items?.extraSpin || 0) + (source.items?.extraSpin || 0),
      pointMagnetUntil: maxDate(target.items?.pointMagnetUntil, source.items?.pointMagnetUntil),
    },
    boxes: {
      mystery: (target.boxes?.mystery || 0) + (source.boxes?.mystery || 0),
    },
    boxPurchases: { ...(target.boxPurchases || {}), ...(source.boxPurchases || {}) },
    equippedTag: source.equippedTag || target.equippedTag || null,
    profileTheme: source.profileTheme || target.profileTheme || null,
    spent: (target.spent || 0) + (source.spent || 0),
  };
}

function formatRankList(items, title) {
  const cleanTitle = formatRankTitle(title);
  if (!items.length) {
    return [
      `╭━━━❰ ${cleanTitle} ❱━━━╮`,
      "┃ Ainda não tenho pontos por aqui.",
      "┃ Mande mensagens para começar o ranking.",
      "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    ].join("\n");
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = items.flatMap((item, index) => {
    const medal = medals[index] || `${index + 1}.`;
    return [
      `┃ ${medal} ${formatDisplayNameWithTag(item)}`,
      `┃    id ${getRankUserId(item.participantId)} • ${item.points || 0} pts • ${item.messages || 0} msgs`,
    ];
  });

  return [
    `╭━━━❰ ${cleanTitle} ❱━━━╮`,
    ...lines,
    "┃",
    `┃ 👥 Listando ${items.length} participante${items.length === 1 ? "" : "s"}`,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function formatRankTitle(title = "") {
  const text = String(title || "Ranking")
    .replace(/\*/g, "")
    .trim();

  if (text.includes("global")) return "🌎 RANKING GLOBAL";
  if (text.includes("grupo")) return "🏆 RANKING DO GRUPO";
  return text.toUpperCase();
}

function formatMyRank(result, displayName) {
  if (!result) return `${displayName}, você ainda não pontuou neste grupo.`;
  const taggedName = formatDisplayNameWithTag({ ...result.user, displayName, participantId: result.user.participantId });
  return `📍 ${taggedName}\n\nPosição: #${result.position}\nPontos: ${result.user.points || 0}\nMensagens pontuadas: ${result.user.messages || 0}`;
}

function getLevelStatsForContext(groupId, participantId) {
  participantId = normalizeParticipantId(participantId);
  return isGroupJid(groupId)
    ? loadStats().groups[groupId]?.users?.[participantId]
    : getGlobalUserStats(participantId);
}

function formatLevelCard({ groupId, participantId, displayName }) {
  const stats = getLevelStatsForContext(groupId, participantId);
  const safeName = getSafeDisplayName({ displayName: stats?.displayName || displayName });
  const levelInfo = getLevelInfo(getUserLevelXp(stats || {}));
  const position = isGroupJid(groupId) ? getLevelPosition(groupId, participantId) : null;

  return [
    "╭━━━❰ ⭐ LEVEL ⭐ ❱━━━╮",
    `┃ Nome: ${safeName}`,
    `┃ ID: ${getRankUserId(participantId)}`,
    `┃ Nível: ${levelInfo.level}`,
    `┃ XP: ${levelInfo.currentXp}/${levelInfo.nextLevelXp}`,
    `┃ Total XP: ${levelInfo.totalXp}`,
    `┃ Progresso: ${formatProgressBar(levelInfo.progress)} ${levelInfo.progress}%`,
    `┃ Faltam: ${levelInfo.remainingXp} XP`,
    `┃ Top level: ${position ? `#${position.position}` : "sem posição"}`,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function formatTopLevel(items) {
  if (!items.length) {
    return [
      "╭━━━❰ ⭐ TOP LEVEL ⭐ ❱━━━╮",
      "┃ Ainda não tenho níveis neste grupo.",
      "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    ].join("\n");
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = items.flatMap((item, index) => {
    const medal = medals[index] || `${index + 1}.`;
    const levelInfo = item.levelInfo || getLevelInfo(getUserLevelXp(item));
    return [
      `┃ ${medal} ${formatDisplayNameWithTag(item)}`,
      `┃    nível ${levelInfo.level} • ${levelInfo.totalXp} XP • id ${getRankUserId(item.participantId)}`,
    ];
  });

  return [
    "╭━━━❰ ⭐ TOP LEVEL ⭐ ❱━━━╮",
    ...lines,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function getAchievementDefinitions({ groupId, participantId }) {
  const groupUser = isGroupJid(groupId) ? loadStats().groups[groupId]?.users?.[participantId] : null;
  const global = getGlobalUserStats(participantId) || {};
  const user = ensureUserActivityFields(groupUser || {});
  const groupPosition = isGroupJid(groupId) ? getUserPosition(groupId, participantId) : null;
  const levelInfo = getLevelInfo(groupUser ? getUserLevelXp(groupUser) : getUserLevelXp(global));
  const ownedTags = getOwnedTags(participantId);
  const ownedThemes = getOwnedProfileThemes(participantId);
  const hasDev = ownedTags.some((tag) => tag.id === "dev") || getEquippedTag(participantId)?.id === "dev";

  return [
    { id: "firstLevel", icon: "⭐", name: "Primeiro Level", unlocked: levelInfo.level >= 2 },
    { id: "active", icon: "🔥", name: "Ativo do Grupo", unlocked: (user.messages || 0) >= 100 },
    { id: "stickerKing", icon: "🎨", name: "Figurinheiro", unlocked: (user.stickerMessages || 0) >= 100 },
    { id: "mediaMaster", icon: "🖼️", name: "Mestre da Mídia", unlocked: (user.mediaMessages || 0) >= 50 },
    { id: "earlyBird", icon: "🌅", name: "Madrugador", unlocked: !!user.achievements?.earlyBird },
    { id: "nightOwl", icon: "🌙", name: "Coruja", unlocked: !!user.achievements?.nightOwl },
    { id: "topOne", icon: "👑", name: "Top 1", unlocked: groupPosition?.position === 1 },
    { id: "collector", icon: "💎", name: "Colecionador", unlocked: ownedTags.length >= 3 },
    { id: "stylist", icon: "🎭", name: "Estiloso", unlocked: ownedThemes.length >= 2 },
    { id: "exclusive", icon: "👽", name: "Exclusivo", unlocked: hasDev },
  ];
}

function formatAchievements({ groupId, participantId, displayName }) {
  const safeName = getSafeDisplayName({ displayName });
  const achievements = getAchievementDefinitions({ groupId, participantId });
  const unlocked = achievements.filter((item) => item.unlocked).length;
  const lines = achievements.map((item) => {
    const marker = item.unlocked ? "✅" : "🔒";
    return `┃ ${marker} ${item.icon} ${item.name}`;
  });

  return [
    "╭━━━❰ 🏅 CONQUISTAS 🏅 ❱━━━╮",
    `┃ ${safeName}`,
    `┃ ${unlocked}/${achievements.length} desbloqueadas`,
    "┃",
    ...lines,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}

function formatUserProfile({ groupId, participantId, displayName }) {
  const wallet = getUserWallet(participantId);
  const levelStats = getLevelStatsForContext(groupId, participantId);
  const groupPosition = isGroupJid(groupId) ? getUserPosition(groupId, participantId) : null;
  const globalPosition = getGlobalUserPosition(participantId);
  const equippedTag = getEquippedTag(participantId);
  const profileTheme = getEquippedProfileTheme(participantId);
  const ownedTags = getOwnedTags(participantId);
  const dailyReward = getDailyReward(participantId, groupId);
  const levelInfo = getLevelInfo(getUserLevelXp(levelStats || {}));
  const achievements = getAchievementDefinitions({ groupId, participantId });
  const unlockedAchievements = achievements.filter((item) => item.unlocked).length;
  const safeName = getSafeDisplayName({ displayName });
  const frame = getProfileFrame(profileTheme);

  return [
    frame.top,
    `┃ Nome: ${safeName}`,
    `┃ ID: ${getRankUserId(participantId)}`,
    `┃ Pontos: ${wallet.balance}`,
    `┃ Level: ${levelInfo.level} (${levelInfo.totalXp} XP)`,
    `┃ Rank grupo: ${groupPosition ? `#${groupPosition.position}` : "sem posição"}`,
    `┃ Rank global: ${globalPosition ? `#${globalPosition.position}` : "sem posição"}`,
    `┃ Tag: ${equippedTag ? equippedTag.name : "nenhuma"}`,
    `┃ Tema: ${profileTheme ? profileTheme.name : "padrão"}`,
    `┃ Aliança: ${dailyReward.marriage ? dailyReward.marriage.partnerName : "nenhuma"}`,
    `┃ Tags: ${ownedTags.length}`,
    `┃ Conquistas: ${unlockedAchievements}/${achievements.length}`,
    `┃ Daily: ${dailyReward.points} pts${equippedTag || dailyReward.marriage ? ` (+${Math.round(dailyReward.bonusRate * 100)}%)` : ""}`,
    frame.bottom,
  ].join("\n");
}

function getProfileFrame(theme) {
  const frames = {
    neon: ["╭━━━❰ 💚 PERFIL NEON 💚 ❱━━━╮", "╰━━━━━━━━━━━━━━━━━━━━━━╯"],
    royal: ["╭━━━❰ 👑 PERFIL ROYAL 👑 ❱━━━╮", "╰━━━━━━━━━━━━━━━━━━━━━━╯"],
    cosmic: ["╭━━━❰ 🌌 PERFIL CÓSMICO 🌌 ❱━━━╮", "╰━━━━━━━━━━━━━━━━━━━━━━╯"],
    owner: ["╭━━━❰ 👽 DEV PERFIL 👽 ❱━━━╮", "╰━━━━━━━━━━━━━━━━━━━━━━╯"],
  };
  const selected = frames[theme?.frame] || ["╭━━━❰ 👤 PERFIL 👤 ❱━━━╮", "╰━━━━━━━━━━━━━━━━━━━━━━╯"];
  return { top: selected[0], bottom: selected[1] };
}

function getGlobalUserPosition(participantId) {
  participantId = normalizeParticipantId(participantId);
  const ranked = rankGlobal();
  const index = ranked.findIndex((item) => item.participantId === participantId);
  if (index < 0) return null;
  return { position: index + 1, user: ranked[index] };
}

function formatRankHelp() {
  return [
    "🏆 *Rank do grupo*",
    "",
    ".iniciarrank → ativa o ranking neste grupo",
    ".rank → top do grupo atual",
    ".rank me → sua posição",
    ".meurank → sua posição",
    ".rank global → soma todos os grupos onde o bot participa",
    "",
    "Pontuação:",
    `texto: +${config.rank.points.text}`,
    `imagem/vídeo/GIF: +${config.rank.points.media}`,
    `figurinha: +${config.rank.points.sticker}`,
    "comandos não pontuam",
  ].join("\n");
}

function getStatsSummary() {
  const root = loadStats();
  const activeGroups = Object.keys(root.enabledGroups || {}).length;
  const users = new Set();

  for (const groupId of Object.keys(root.enabledGroups || {})) {
    const group = root.groups[groupId];
    for (const participantId of Object.keys(group?.users || {})) {
      const normalizedId = normalizeParticipantId(participantId);
      if (normalizedId && !isGroupJid(normalizedId)) users.add(normalizedId);
    }
  }

  return {
    activeGroups,
    rankedUsers: users.size,
  };
}

function resetStatsForTests() {
  stats = {
    groups: {},
    enabledGroups: {},
    rankIds: {},
    nextRankId: 1,
    shop: { users: {} },
    daily: { users: {} },
    roulette: { users: {} },
    social: {
      gifts: { users: {}, history: [] },
      marriages: { groups: {} },
    },
  };
  lastScoredAt.clear();
  clearTimeout(saveTimer);
}

module.exports = {
  acceptMarriage,
  addActivity,
  addLevelXp,
  addRankPoints,
  buyProfileTheme,
  buyBenefit,
  buyShopItem,
  buyTag,
  cancelMarriageProposal,
  claimDaily,
  claimRoulette,
  claimTurboRedeem,
  createMarriageProposal,
  declineMarriage,
  divorceMarriage,
  equipTag,
  equipProfileTheme,
  formatDisplayNameWithTag,
  formatAchievements,
  formatLevelCard,
  formatMyRank,
  formatUserProfile,
  findParticipantId,
  formatRankHelp,
  formatRankList,
  formatTopLevel,
  formatOwnedTags,
  formatProfileThemeShop,
  formatShop,
  formatMarriageHelp,
  formatMarriageInfo,
  formatInventory,
  formatMysteryBoxInfo,
  formatDailyBonus,
  getRarityIcon,
  getDisplayName,
  getDailyReward,
  getBenefitByQuery,
  getBenefitById,
  getInventory,
  getMysteryBoxPrize,
  getMarriage,
  getMarriageDailyBonusRate,
  getRoulettePrize,
  getActivityType,
  getEquippedTag,
  getEquippedProfileTheme,
  getGlobalUserStats,
  getGlobalUserPosition,
  getMessageScore,
  getLevelInfo,
  getLevelStatsForContext,
  getUserLevelXp,
  getOwnedTags,
  getOwnedProfileThemes,
  getParticipantId,
  getProfileThemeByQuery,
  getRankUserId,
  getSafeDisplayName,
  getStatsSummary,
  getStatsPath,
  getTagByQuery,
  getUserWallet,
  hasBenefit,
  openMysteryBox,
  getUserPosition,
  getLevelPosition,
  grantProfileTheme,
  grantTag,
  isRankEnabled,
  isGroupJid,
  isRankCommand,
  loadStats,
  normalizeParticipantId,
  parseGiftCommand,
  parseMarriageCommand,
  parseRankCommand,
  parseShopCommand,
  rankGlobal,
  rankGroup,
  rankLevelGroup,
  removeRankPoints,
  removeLevelXp,
  removeUserGlobally,
  removeUserFromGroupByName,
  resetGroupRank,
  resetGroupLevel,
  resetGlobalRank,
  resetStatsForTests,
  resolveParticipantId,
  revokeProfileTheme,
  revokeTag,
  saveStatsNow,
  sanitizeDisplayName,
  sendGift,
  setRankEnabled,
  setRankPoints,
  setLevelXp,
  spendRankPoints,
  startRank,
  unequipTag,
};
