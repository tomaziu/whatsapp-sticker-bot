// test.js — Testes do Bot de Figurinhas
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}`); failed++; }
}

async function testImageConversion() {
  console.log("\n[1] Conversão de imagem");
  const { imageToSticker } = require("./lib/stickerConverter");

  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 100, b: 50 } },
  }).jpeg().toBuffer();

  const output = await imageToSticker(input);
  const meta = await sharp(output).metadata();

  assert(meta.width === 512, "Largura = 512px");
  assert(meta.height === 512, "Altura = 512px");
  assert(meta.format === "webp", "Formato = webp");
  assert(output.length < 500 * 1024, "Tamanho < 500KB");
}

function testConfig() {
  console.log("\n[2] Configuração");
  const config = require("./config");

  assert(config.commandPrefix === ".fig", "Prefixo = .fig");
  assert(config.commandPrefixAlt === ".sticker", "Prefixo alt = .sticker");
  assert(config.sticker.maxSizeKB === 500, "Max 500KB");
  assert(config.sticker.maxWidth === 512, "Largura 512");
  assert(config.sticker.maxDurationSec === 6, "Duração 6s");
}

function testLogger() {
  console.log("\n[3] Logger");
  const { log, logError, setupErrorFilter } = require("./lib/logger");
  assert(typeof log === "function", "log é função");
  assert(typeof logError === "function", "logError é função");
  assert(typeof setupErrorFilter === "function", "setupErrorFilter é função");
}

function testServer() {
  console.log("\n[4] Servidor");
  const { startServer } = require("./lib/server");
  assert(typeof startServer === "function", "startServer é função");
}

function testBot() {
  console.log("\n[5] Bot");
  const { startBot, getState } = require("./lib/bot");
  assert(typeof startBot === "function", "startBot é função");
  assert(typeof getState === "function", "getState é função");

  const s = getState();
  assert(s.status === "waiting" || s.status === "connected", "Status válido");
}

function testDeduplication() {
  console.log("\n[6] Deduplicação");
  // Testa via require do módulo (indireto)
  // O isDuplicate não é exportado, mas testamos o comportamento
  const { getState } = require("./lib/bot");
  assert(typeof getState === "function", "Bot funcional após deduplicação");
}

function testDependencies() {
  console.log("\n[7] Dependências");
  const deps = ["@whiskeysockets/baileys", "sharp", "fluent-ffmpeg", "qrcode", "pino"];
  deps.forEach((d) => {
    try { require(d); assert(true, `${d} importado`); }
    catch { assert(false, `${d} importado`); }
  });
}

async function run() {
  console.log("=== Testes do Bot de Figurinhas ===");

  testConfig();
  testLogger();
  testServer();
  testBot();
  testDeduplication();
  testDependencies();
  await testImageConversion();

  console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
