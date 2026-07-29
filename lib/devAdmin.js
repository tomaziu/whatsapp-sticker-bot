const fs = require("fs");
const path = require("path");

const ACTION_TOKENS = {
  restart: "reiniciar",
  reset_global_rank: "zerar-global",
  reset_group_rank: "zerar-grupo",
  remove_rank: "remover-rank",
};

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getActionToken(action = "") {
  return ACTION_TOKENS[action] || normalizeToken(action).replace(/_/g, "-");
}

function createConfirmationManager({ ttlMs = 60 * 1000 } = {}) {
  const pendingByChat = new Map();

  return {
    request(chatId, action, payload = {}, now = Date.now()) {
      const token = getActionToken(action);
      const pending = {
        action,
        token,
        payload,
        requestedAt: now,
        expiresAt: now + ttlMs,
      };
      pendingByChat.set(chatId, pending);
      return pending;
    },

    confirm(chatId, token, now = Date.now()) {
      const pending = pendingByChat.get(chatId);
      if (!pending) return { ok: false, reason: "missing" };

      if (now >= pending.expiresAt) {
        pendingByChat.delete(chatId);
        return { ok: false, reason: "expired" };
      }

      if (normalizeToken(token) !== pending.token) {
        return { ok: false, reason: "mismatch", expectedToken: pending.token };
      }

      pendingByChat.delete(chatId);
      return { ok: true, pending };
    },

    clear() {
      pendingByChat.clear();
    },
  };
}

function createRankBackup({ sourcePath, now = Date.now(), fsImpl = fs } = {}) {
  const resolvedSource = path.resolve(sourcePath || "");
  const raw = fsImpl.readFileSync(resolvedSource, "utf8");
  JSON.parse(raw);

  const backupDir = path.join(path.dirname(resolvedSource), "backups");
  fsImpl.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date(now).toISOString()
    .replace(/\D/g, "")
    .slice(0, 17);
  const baseName = `rank-stats-${timestamp}`;
  let suffix = 0;

  while (true) {
    const filename = `${baseName}${suffix ? `-${suffix}` : ""}.json`;
    const backupPath = path.join(backupDir, filename);
    try {
      fsImpl.copyFileSync(
        resolvedSource,
        backupPath,
        fsImpl.constants?.COPYFILE_EXCL ?? fs.constants.COPYFILE_EXCL
      );
      return {
        path: backupPath,
        filename,
        size: fsImpl.statSync(backupPath).size,
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      suffix++;
    }
  }
}

function getFileStatus(filePath, fsImpl = fs) {
  const resolvedPath = path.resolve(filePath || "");
  if (!fsImpl.existsSync(resolvedPath)) {
    return { exists: false, path: resolvedPath, size: 0, modifiedAt: null };
  }

  const stat = fsImpl.statSync(resolvedPath);
  return {
    exists: true,
    path: resolvedPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function formatSize(value = 0) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

function formatDiagnostic({ state = {}, hasSession = false, uptimeMs = 0, memoryRss = 0, diskFreeBytes } = {}) {
  return [
    "🩺 *Diagnóstico do bot*",
    "",
    `📡 WhatsApp: ${state.status || "desconhecido"}`,
    `🔐 Sessão: ${hasSession ? "Login salvo" : "Sem login"}`,
    `⚠️ Última queda: ${state.lastDisconnect || "nenhuma"}`,
    `🔁 Reconexões: ${state.reconnectAttempts || 0}`,
    `⏱️ Uptime: ${formatDuration(uptimeMs)}`,
    `🧠 Memória: ${formatSize(memoryRss)}`,
    ...(diskFreeBytes === undefined ? [] : [`💾 Disco livre: ${formatSize(diskFreeBytes)}`]),
  ].join("\n");
}

function formatSessionStatus({ state = {}, hasSession = false } = {}) {
  return [
    "🔐 *Status da sessão*",
    "",
    `Login: ${hasSession ? "Login salvo" : "Sem login"}`,
    `Conexão: ${state.status || "desconhecido"}`,
    `QR disponível: ${state.currentQR ? "sim" : "não"}`,
    `Última queda: ${state.lastDisconnect || "nenhuma"}`,
    `Reconexões: ${state.reconnectAttempts || 0}`,
  ].join("\n");
}

function formatRankStatus({ summary = {}, fileStatus = {} } = {}) {
  return [
    "🏆 *Status do rank*",
    "",
    `Grupos ativos: ${summary.activeGroups || 0}`,
    `Usuários: ${summary.rankedUsers || 0}`,
    `Arquivo: ${fileStatus.exists ? "disponível" : "não encontrado"}`,
    `Tamanho: ${formatSize(fileStatus.size || 0)}`,
    `Última gravação: ${fileStatus.modifiedAt || "indisponível"}`,
  ].join("\n");
}

module.exports = {
  createConfirmationManager,
  createRankBackup,
  formatDiagnostic,
  formatRankStatus,
  formatSessionStatus,
  formatSize,
  getActionToken,
  getFileStatus,
  normalizeToken,
};
