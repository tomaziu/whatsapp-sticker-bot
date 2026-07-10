/**
 * lib/logger.js — Intercepta erros de criptografia e mantém terminal limpo
 */

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

function log(msg) {
  console.log(`[OK] ${msg}`);
}

function logError(msg) {
  console.log(`[ERRO] ${msg}`);
}

module.exports = { setupErrorFilter, log, logError };
