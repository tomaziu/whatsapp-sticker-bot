// test.js — Testa se o conversor de figurinhas funciona
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function testImageToSticker() {
  console.log("=== Teste de Conversão de Imagem ===");

  // Cria uma imagem de teste 800x600 (não quadrada)
  const testImage = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 255, g: 100, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();

  console.log(`[OK] Imagem de teste criada: ${(testImage.length / 1024).toFixed(1)} KB`);

  // Converte para WebP 512x512
  const sticker = await sharp(testImage)
    .resize(512, 512, { fit: "fill" })
    .webp({ quality: 80 })
    .toBuffer();

  console.log(`[OK] Figurinha criada: ${(sticker.length / 1024).toFixed(1)} KB`);

  // Verifica dimensões
  const metadata = await sharp(sticker).metadata();
  console.log(`[OK] Dimensões: ${metadata.width}x${metadata.height}`);
  console.log(`[OK] Formato: ${metadata.format}`);

  if (metadata.width === 512 && metadata.height === 512 && metadata.format === "webp") {
    console.log("\n✅ Conversão de imagem FUNCIONA!");
  } else {
    console.log("\n❌ Conversão de imagem FALHOU!");
  }

  // Salva para inspeção visual
  const outPath = path.join(__dirname, "test-sticker.webp");
  fs.writeFileSync(outPath, sticker);
  console.log(`[OK] Figurinha salva em: ${outPath}`);
}

async function testDownloadMedia() {
  console.log("\n=== Teste de Funções do Baileys ===");
  try {
    const { downloadMediaMessage } = require("@whiskeysockets/baileys");
    console.log(`[OK] downloadMediaMessage importado: ${typeof downloadMediaMessage}`);
  } catch (err) {
    console.log(`[ERRO] Falha ao importar downloadMediaMessage: ${err.message}`);
  }

  try {
    const sharp = require("sharp");
    console.log(`[OK] sharp importado: ${typeof sharp}`);
  } catch (err) {
    console.log(`[ERRO] Falha ao importar sharp: ${err.message}`);
  }

  try {
    const ffmpeg = require("fluent-ffmpeg");
    console.log(`[OK] fluent-ffmpeg importado: ${typeof ffmpeg}`);
  } catch (err) {
    console.log(`[ERRO] Falha ao importar fluent-ffmpeg: ${err.message}`);
  }

  try {
    const QRCode = require("qrcode");
    console.log(`[OK] qrcode importado: ${typeof QRCode}`);
  } catch (err) {
    console.log(`[ERRO] Falha ao importar qrcode: ${err.message}`);
  }
}

async function run() {
  await testImageToSticker();
  await testDownloadMedia();
  console.log("\n=== Todos os testes concluídos ===");
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
