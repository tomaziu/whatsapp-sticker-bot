// test.js — Testes do Bot de Figurinhas
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

// ─── Teste 1: Conversão de imagem ──────────────────────────────────
async function testImageConversion() {
  console.log("\n[1] Conversão de imagem para WebP");

  const { imageToSticker } = require("./lib/stickerConverter");

  // Cria imagem de teste 800x600
  const input = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();

  const output = await imageToSticker(input);
  const meta = await sharp(output).metadata();

  assert(meta.width === 512, "Largura = 512px");
  assert(meta.height === 512, "Altura = 512px");
  assert(meta.format === "webp", "Formato = webp");
  assert(output.length < 500 * 1024, "Tamanho < 500KB");

  // Salva para inspeção visual
  fs.writeFileSync(path.join(__dirname, "test-output.webp"), output);
}

// ─── Teste 2: Configuração ─────────────────────────────────────────
function testConfig() {
  console.log("\n[2] Configuração");
  const config = require("./config");

  assert(config.commandPrefix === ".fig", "Prefixo = .fig");
  assert(config.commandPrefixAlt === ".sticker", "Prefixo alternativo = .sticker");
  assert(config.sticker.maxSizeKB === 500, "Tamanho máximo = 500KB");
  assert(config.sticker.maxWidth === 512, "Largura máxima = 512px");
  assert(config.sticker.maxDurationSec === 6, "Duração máxima = 6s");
  assert(config.qrServerPort === 3000, "Porta do servidor = 3000");
}

// ─── Teste 3: Logger ───────────────────────────────────────────────
function testLogger() {
  console.log("\n[3] Logger");
  const { log, logError } = require("./lib/logger");

  assert(typeof log === "function", "log é uma função");
  assert(typeof logError === "function", "logError é uma função");
}

// ─── Teste 4: Servidor HTTP ────────────────────────────────────────
function testServer() {
  console.log("\n[4] Servidor HTTP");
  const { startServer } = require("./lib/server");

  assert(typeof startServer === "function", "startServer é uma função");
}

// ─── Teste 5: Bot ──────────────────────────────────────────────────
function testBot() {
  console.log("\n[5] Bot");
  const { startBot, getState } = require("./lib/bot");

  assert(typeof startBot === "function", "startBot é uma função");
  assert(typeof getState === "function", "getState é uma função");

  const state = getState();
  assert(state.currentQR === null || typeof state.currentQR === "string", "currentQR válido");
  assert(state.status === "waiting" || state.status === "connected", "status válido");
}

// ─── Teste 6: Dependências ─────────────────────────────────────────
function testDependencies() {
  console.log("\n[6] Dependências");

  try { require("@whiskeysockets/baileys"); assert(true, "baileys importado"); }
  catch { assert(false, "baileys importado"); }

  try { require("sharp"); assert(true, "sharp importado"); }
  catch { assert(false, "sharp importado"); }

  try { require("fluent-ffmpeg"); assert(true, "fluent-ffmpeg importado"); }
  catch { assert(false, "fluent-ffmpeg importado"); }

  try { require("qrcode"); assert(true, "qrcode importado"); }
  catch { assert(false, "qrcode importado"); }
}

// ─── Executa todos os testes ───────────────────────────────────────
async function run() {
  console.log("=== Testes do Bot de Figurinhas ===");

  testConfig();
  testLogger();
  testServer();
  testBot();
  testDependencies();
  await testImageConversion();

  console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam ===`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
