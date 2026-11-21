/**
 * index.js — Ponto de entrada do Bot de Figurinhas
 *
 * Uso: npm start
 * Autenticação: Código de pareamento (pairing code)
 * Configure PAIRING_PHONE no .env ou config.js (ex: 5511999999999)
 */
const { setupErrorFilter, log } = require("./lib/logger");
const { startBot } = require("./lib/bot");
const config = require("./config");

async function main() {
  setupErrorFilter();

  log("🤖 Iniciando bot com autenticação por código de pareamento...");
  log(`📱 Número configurado: ${config.pairing?.phoneNumber || process.env.PAIRING_PHONE || "NÃO CONFIGURADO"}`);

  await startBot();
}

main().catch((e) => {
  log(`[FATAL] ${e.message}`);
  process.exit(1);
});
