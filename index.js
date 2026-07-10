/**
 * index.js — Ponto de entrada do Bot de Figurinhas
 *
 * Uso: npm start
 * QR Code: http://localhost:3000
 */
const { setupErrorFilter, log } = require("./lib/logger");
const { startServer } = require("./lib/server");
const { startBot, getState } = require("./lib/bot");
const config = require("./config");

// Filtra erros de criptografia do terminal
setupErrorFilter();

// Inicia servidor QR + bot
startServer(config.qrServerPort || 3000, getState);
startBot().catch((e) => {
  console.log(`[FATAL] ${e.message}`);
  process.exit(1);
});
