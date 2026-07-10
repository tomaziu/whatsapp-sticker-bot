/**
 * lib/logger.js — Filtro de erros + log em arquivo
 */
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "errors.log");

// Cria pasta de logs se não existir
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function isCryptoNoise(str) {
  return (
    str.includes("Bad MAC") ||
    str.includes("Session error") ||
    str.includes("Failed to decrypt") ||
    str.includes("SessionEntry") ||
    str.includes("Closing session") ||
    str.includes("Closing open session") ||
    str.includes("session_cipher") ||
    str.includes("crypto.js") ||
    str.includes("group_cipher") ||
    str.includes("session_builder") ||
    str.includes("doDecryptWhisperMessage") ||
    str.includes("verifyMAC") ||
    str.includes("decryptWithSessions") ||
    str.includes("processTicksAndRejections") ||
    str.includes("_asyncQueueExecutor") ||
    str.includes("queue-job")
  );
}

function setupErrorFilter() {
  const _origError = console.error;
  const _origWarn = console.warn;

  console.error = (...args) => {
    if (args.some((a) => isCryptoNoise(String(a)))) return;
    _origError(...args);
  };

  console.warn = (...args) => {
    if (args.some((a) => isCryptoNoise(String(a)))) return;
    _origWarn(...args);
  };

  const _origStderrWrite = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    if (isCryptoNoise(str)) return true;
    return _origStderrWrite.call(process.stderr, chunk, ...rest);
  };
}

function getTimestamp() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function writeLog(type, msg) {
  const line = `[${getTimestamp()}] [${type}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

function log(msg) {
  console.log(`[OK] ${msg}`);
  writeLog("OK", msg);
}

function logError(msg) {
  console.log(`[ERRO] ${msg}`);
  writeLog("ERRO", msg);
}

module.exports = { setupErrorFilter, log, logError };
