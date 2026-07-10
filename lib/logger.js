/**
 * lib/logger.js — Filtro de erros + log em arquivo
 */
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "errors.log");

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
    str.includes("queue-job") ||
    str.includes("chainKey") ||
    str.includes("currentRatchet") ||
    str.includes("ephemeralKeyPair") ||
    str.includes("remoteIdentityKey") ||
    str.includes("registrationId") ||
    str.includes("baseKey") ||
    str.includes("pendingPreKey") ||
    str.includes("messageKeys")
  );
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

function setupErrorFilter() {
  const _origError = console.error;
  const _origWarn = console.warn;

  console.error = (...args) => {
    const msg = args.map(String).join(" ");
    writeLog("ERRO", msg.substring(0, 500));
    if (isCryptoNoise(msg)) return;
    _origError(...args);
  };

  console.warn = (...args) => {
    const msg = args.map(String).join(" ");
    writeLog("WARN", msg.substring(0, 500));
    if (isCryptoNoise(msg)) return;
    _origWarn(...args);
  };

  const _origStderrWrite = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    writeLog("STDERR", str.substring(0, 300));
    if (isCryptoNoise(str)) return true;
    return _origStderrWrite.call(process.stderr, chunk, ...rest);
  };
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
