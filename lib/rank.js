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
  const migrated = migrateParticipantIds(stats);
  if (!stats.nextRankId) stats.nextRankId = getNextRankId(stats.rankIds);
  if (migrated) scheduleSave();
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

function canScore(groupId, participantId, now = Date.now()) {
  const key = `${groupId}:${participantId}`;
  const last = lastScoredAt.get(key) || 0;
  if (now - last < config.rank.antiSpamMs) return false;
  lastScoredAt.set(key, now);
  return true;
}

function addActivity({ groupId, participantId, displayName, points, now = Date.now() }) {
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
    messages: 0,
    displayName: usefulDisplayName || safeDisplayName || "Participante",
    lastActivityAt: null,
  };

  user.points += points;
  user.messages += 1;
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
        messages: 0,
        displayName: user.displayName,
        lastActivityAt: null,
      };
      current.points += user.points || 0;
      current.messages += user.messages || 0;
      current.displayName = user.displayName || current.displayName;
      current.lastActivityAt = maxDate(current.lastActivityAt, user.lastActivityAt);
      merged[participantId] = current;
    }
  }
  return sortUsers(merged).slice(0, limit);
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

function getUserPosition(groupId, participantId) {
  if (!isRankEnabled(groupId)) return null;
  const ranked = rankGroup(groupId, Number.MAX_SAFE_INTEGER);
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

function formatRankList(items, title) {
  if (!items.length) {
    return `${title}\n\nAinda não tenho pontos suficientes por aqui.`;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = items.map((item, index) => {
    const medal = medals[index] || `${index + 1}.`;
    return `${medal} ${getSafeDisplayName(item)} [id: ${getRankUserId(item.participantId)}] — ${item.points || 0} pts (${item.messages || 0} msgs)`;
  });

  return `${title}\n\n${lines.join("\n")}`;
}

function formatMyRank(result, displayName) {
  if (!result) return `${displayName}, você ainda não pontuou neste grupo.`;
  return `📍 ${displayName}\n\nPosição: #${result.position}\nPontos: ${result.user.points || 0}\nMensagens pontuadas: ${result.user.messages || 0}`;
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
  stats = { groups: {}, enabledGroups: {}, rankIds: {}, nextRankId: 1 };
  lastScoredAt.clear();
  clearTimeout(saveTimer);
}

module.exports = {
  addActivity,
  formatMyRank,
  formatRankHelp,
  formatRankList,
  getDisplayName,
  getMessageScore,
  getParticipantId,
  getRankUserId,
  getSafeDisplayName,
  getStatsSummary,
  getStatsPath,
  getUserPosition,
  isRankEnabled,
  isGroupJid,
  isRankCommand,
  loadStats,
  normalizeParticipantId,
  parseRankCommand,
  rankGlobal,
  rankGroup,
  removeUserGlobally,
  removeUserFromGroupByName,
  resetGroupRank,
  resetGlobalRank,
  resetStatsForTests,
  saveStatsNow,
  sanitizeDisplayName,
  setRankEnabled,
  startRank,
};
