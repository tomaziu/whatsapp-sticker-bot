const fs = require("fs");
const path = require("path");
const config = require("../config");

function getSessionPath() {
  return path.resolve(process.cwd(), config.paths.authInfo);
}

function ensureSessionDir() {
  fs.mkdirSync(getSessionPath(), { recursive: true });
}

function sessionExists() {
  return fs.existsSync(path.join(getSessionPath(), "creds.json"));
}

function clearSession() {
  fs.rmSync(getSessionPath(), { recursive: true, force: true });
  ensureSessionDir();
}

module.exports = {
  clearSession,
  ensureSessionDir,
  getSessionPath,
  sessionExists,
};
