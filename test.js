const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const config = require("./config");

config.paths.rankStats = path.join(os.tmpdir(), `sticker-rank-test-${process.pid}.json`);

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
    return;
  }

  console.log(`  ✗ ${message}`);
  failed++;
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (${actual} === ${expected})`);
}

function skip(message) {
  console.log(`  - ${message}`);
  skipped++;
}

async function testImageConversion() {
  console.log("\n[1] Imagem 1:1");
  const { imageToSticker } = require("./lib/stickerConverter");

  const input = await sharp({
    create: {
      width: 1200,
      height: 600,
      channels: 3,
      background: { r: 20, g: 180, b: 90 },
    },
  }).jpeg().toBuffer();

  const output = await imageToSticker(input);
  const meta = await sharp(output).metadata();

  assertEqual(meta.width, 512, "Largura final");
  assertEqual(meta.height, 512, "Altura final");
  assertEqual(meta.format, "webp", "Formato final");
  assert(output.length <= 500 * 1024, "Imagem abaixo de 500KB");
  assert(output.includes(Buffer.from("bot do @tomm")), "Imagem inclui autor no metadata");
  assert(output.includes(Buffer.from("Figurinhas do bot")), "Imagem inclui nome do pacote");
  assertEqual(output.toString("ascii", 12, 16), "VP8X", "Imagem declara VP8X");
  assert((output[20] & 0x08) === 0x08, "Imagem declara flag EXIF");
}

async function testVideoConversion() {
  console.log("\n[2] Vídeo 1:1");
  const { videoToSticker } = require("./lib/stickerConverter");
  const inputPath = path.join(os.tmpdir(), `sticker-test-${Date.now()}.mp4`);

  try {
    execFileSync("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc=size=640x360:rate=15:duration=2",
      "-pix_fmt", "yuv420p",
      inputPath,
    ], { stdio: "ignore" });
  } catch {
    skip("ffmpeg indisponível; teste de vídeo pulado");
    return;
  }

  try {
    const output = await videoToSticker(fs.readFileSync(inputPath));
    const meta = await sharp(output).metadata();

    assert(meta.width === meta.height, "Vídeo fica quadrado");
    assert(meta.width <= 512, "Vídeo respeita limite 512px");
    assertEqual(meta.format, "webp", "Vídeo vira WebP");
    assert(output.length <= 500 * 1024, "Vídeo abaixo de 500KB");
    assert(output.includes(Buffer.from("bot do @tomm")), "Vídeo inclui autor no metadata");
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
  }
}

function testConfig() {
  console.log("\n[3] Configuração");
  const config = require("./config");

  assert(config.commands.sticker.includes(".fig"), "Comando .fig ativo");
  assert(config.commands.sticker.includes(".sticker"), "Comando .sticker ativo");
  assertEqual(config.commands.menu, ".menu", "Comando de menu");
  assertEqual(config.bot.allowSelfMessages, true, "Permite testar consigo mesmo");
  assertEqual(config.sticker.size, 512, "Sticker base 512");
  assertEqual(config.sticker.maxSizeKB, 500, "Limite 500KB");
  assertEqual(config.sticker.author, "bot do @tomm", "Autor do sticker");
  assert(config.bot.reconnectMinMs > 0, "Reconexão mínima configurada");
  assert(config.bot.reconnectMaxMs >= config.bot.reconnectMinMs, "Reconexão máxima configurada");
}

function testBotHelpers() {
  console.log("\n[4] Bot e comandos");
  const { getState, startBot, _private } = require("./lib/bot");

  assert(typeof startBot === "function", "startBot exportado");
  assert(typeof getState === "function", "getState exportado");
  assert(_private.isMenuCommand(" .MENU "), ".menu é case-insensitive");
  assert(_private.isStickerCommand(" .FIG "), ".fig é case-insensitive");
  assert(_private.isStickerCommand(".sticker"), ".sticker funciona");
  assert(!_private.shouldIgnoreMessage({ key: { fromMe: true, remoteJid: "me@s.whatsapp.net" } }), "Não ignora mensagens próprias");
  assert(_private.shouldIgnoreMessage({ key: { remoteJid: "status@broadcast" } }), "Ignora status");
  assert(_private.shouldIgnoreMessage({ key: { remoteJid: "120363@newsletter" } }), "Ignora canais/newsletters");
  assert(!_private.MENU_TEXT.includes(".zerarrank"), "Menu não mostra zerarrank");
  assert(!_private.MENU_TEXT.includes(".removerank"), "Menu não mostra removerank");
  assert(!_private.MENU_TEXT.includes("Teste consigo mesmo"), "Menu não mostra teste consigo mesmo");
  assert(!_private.MENU_TEXT.includes("Formas de usar"), "Menu não mostra formas de usar");
  assert(!_private.MENU_TEXT.includes("Vídeos"), "Menu não mostra seção de vídeo");
  assert(!_private.MENU_TEXT.includes("FORMATO"), "Menu não mostra seção formato");
  assertEqual(_private.normalizeUserJid("551199999999:12@s.whatsapp.net"), "551199999999@s.whatsapp.net", "Normaliza JID do próprio bot");
}

async function testRankCommandOutsideGroup() {
  console.log("\n[5] Rank fora de grupo");
  const { _private } = require("./lib/bot");

  const handled = await _private.handleRankCommand(
    "5511999999999@s.whatsapp.net",
    { key: { remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: ".rank" } },
    ".rank"
  );

  assert(handled, "Comando rank em PV é consumido");
}

function testMediaParsing() {
  console.log("\n[6] Leitura de mídia");
  const { _private } = require("./lib/bot");

  const imageMessage = { imageMessage: { caption: ".fig" } };
  const videoMessage = { videoMessage: { caption: ".fig" } };
  const wrapped = { ephemeralMessage: { message: imageMessage } };

  assertEqual(_private.getMedia(imageMessage).type, "image", "Detecta imagem");
  assertEqual(_private.getMedia(videoMessage).type, "video", "Detecta vídeo/GIF");
  assertEqual(_private.getMedia(wrapped).type, "image", "Desembrulha mensagem ephemeral");
  assertEqual(_private.getText({ conversation: ".menu" }), ".menu", "Lê texto simples");
  assertEqual(_private.getText(imageMessage), ".fig", "Lê legenda");

  const quoted = _private.getQuotedMedia({
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: ".fig",
        contextInfo: {
          stanzaId: "quoted-1",
          quotedMessage: imageMessage,
        },
      },
    },
  });

  assert(quoted, "Detecta mídia respondida");
  assertEqual(quoted.media.type, "image", "Preserva tipo da mídia respondida");
}

function testRankHelpers() {
  console.log("\n[7] Ranking");
  const rank = require("./lib/rank");
  const config = require("./config");
  rank.resetStatsForTests();

  const groupA = "120363-a@g.us";
  const groupB = "120363-b@g.us";
  const ana = "551111111111@s.whatsapp.net";
  const bia = "552222222222@s.whatsapp.net";

  assert(rank.isGroupJid(groupA), "Reconhece JID de grupo");
  assertEqual(rank.parseRankCommand(".rank").type, "group", ".rank mostra grupo");
  assertEqual(rank.parseRankCommand(".rank global").type, "global", ".rank global mostra global");
  assertEqual(rank.parseRankCommand(".meurank").type, "me", ".meurank mostra posição");
  assertEqual(rank.parseRankCommand(".iniciarrank").type, "start", ".iniciarrank ativa grupo");
  assertEqual(rank.parseRankCommand(".zerarrank").type, "reset", ".zerarrank zera rank");
  assertEqual(rank.parseRankCommand(".zerarrank").scope, "group", ".zerarrank zera grupo atual");
  assertEqual(rank.parseRankCommand(".zerarrank global").scope, "global", ".zerarrank global zera todos");
  assertEqual(rank.parseRankCommand(".removerank Ana Maria").type, "remove", ".removerank remove usuário");
  assertEqual(rank.parseRankCommand(".removerank Ana Maria").query, "Ana Maria", ".removerank preserva nome");
  assert(!rank.isRankEnabled(groupA), "Rank começa desligado no grupo");
  assertEqual(rank.getMessageScore({ text: "oi" }), config.rank.points.text, "Texto pontua");
  assertEqual(rank.getMessageScore({ media: { type: "image" } }), config.rank.points.media, "Mídia pontua");
  assertEqual(rank.getMessageScore({ isSticker: true }), config.rank.points.sticker, "Sticker pontua");
  assertEqual(rank.getMessageScore({ text: ".fig" }), 0, "Comando não pontua");

  const ignored = rank.addActivity({ groupId: groupA, participantId: ana, displayName: "Ana", points: 1, now: 10000 });
  assert(!ignored, "Grupo sem .iniciarrank não pontua");

  rank.loadStats().groups[groupA] = {
    users: {
      [ana]: { points: 99, messages: 99, displayName: "Ana" },
    },
  };
  rank.startRank(groupA, 10000);
  rank.startRank(groupB, 10000);
  assert(rank.isRankEnabled(groupA), "Ativa ranking por grupo");
  assertEqual(rank.rankGroup(groupA).length, 0, ".iniciarrank começa zerado na primeira ativação");

  rank.addActivity({ groupId: groupA, participantId: ana, displayName: "Ana", points: 1, now: 20000 });
  rank.addActivity({ groupId: groupA, participantId: bia, displayName: "Bia", points: 2, now: 30000 });
  rank.addActivity({ groupId: groupB, participantId: ana, displayName: "Ana", points: 3, now: 40000 });

  const groupRank = rank.rankGroup(groupA);
  assertEqual(groupRank[0].displayName, "Bia", "Rank do grupo é separado");
  assertEqual(groupRank[0].points, 2, "Rank ordena por pontos");

  const globalRank = rank.rankGlobal();
  assertEqual(globalRank[0].displayName, "Ana", "Rank global soma grupos");
  assertEqual(globalRank[0].points, 4, "Rank global soma pontos");

  const position = rank.getUserPosition(groupA, ana);
  assertEqual(position.position, 2, "Mostra posição do usuário");
  assert(rank.formatRankList(groupRank, "🏆 *Ranking do grupo*").includes("Bia"), "Formata ranking");
  assert(rank.formatRankList(groupRank, "🏆 *Ranking do grupo*").includes("[id: 02]"), "Ranking mostra ID público curto");
  assertEqual(rank.getRankUserId(ana), "01", "Primeiro ID público é 01");
  assertEqual(rank.getRankUserId(bia), "02", "Segundo ID público é 02");
  assert(rank.formatMyRank(position, "Ana").includes("Posição: #2"), "Formata meu rank");
  assert(rank.formatRankHelp().includes(".rank global"), "Ajuda explica variações");
  assert(!rank.formatRankHelp().includes(".pararrank"), "Ajuda não mostra pararrank");
  assertEqual(rank.sanitizeDisplayName("5511999999999"), "", "Remove número como nome");
  assertEqual(rank.sanitizeDisplayName("5511999999999@s.whatsapp.net"), "", "Remove JID como nome");
  assertEqual(rank.getSafeDisplayName({ displayName: "5511999999999" }), "Participante", "Fallback sem número no rank");
  assert(!rank.formatRankList([{ displayName: "5511999999999", points: 1, messages: 1 }], "Rank").includes("5511999999999"), "Ranking não mostra número");
  assert(!rank.addActivity({ groupId: groupA, participantId: groupA, displayName: "Participante", points: 1, now: 50000 }), "Não pontua usando ID do grupo como participante");

  rank.addActivity({ groupId: groupA, participantId: ana, displayName: "Participante", points: 1, now: 60000 });
  assertEqual(rank.rankGroup(groupA).find((item) => item.participantId === ana).displayName, "Ana", "Não troca nome conhecido por Participante");

  const removeMissing = rank.removeUserFromGroupByName(groupA, "Carlos");
  assertEqual(removeMissing.removed.length, 0, "Não remove nome inexistente");

  const removeResult = rank.removeUserGlobally("2");
  assertEqual(removeResult.removed.length, 1, "Remove usuário pelo ID");
  assert(!rank.rankGroup(groupA).some((item) => item.displayName === "Bia"), "Usuário removido sai do rank");
  assert(rank.rankGlobal().some((item) => item.displayName === "Ana"), "Remoção do grupo mantém outros grupos");

  const removeGlobal = rank.removeUserGlobally("ana");
  assertEqual(removeGlobal.removed.length, 2, "Remove usuário globalmente pelo nome");
  assert(!rank.rankGlobal().some((item) => item.displayName === "Ana"), "Usuário removido sai do rank global");

  rank.addActivity({ groupId: groupA, participantId: ana, displayName: "Ana", points: 1, now: 70000 });
  rank.addActivity({ groupId: groupB, participantId: ana, displayName: "Ana", points: 3, now: 80000 });

  rank.resetGroupRank(groupA);
  assertEqual(rank.rankGroup(groupA).length, 0, "Zera ranking do grupo atual");
  assertEqual(rank.rankGlobal()[0].displayName, "Ana", "Reset de grupo mantém outros grupos");
  assert(rank.isRankEnabled(groupA), "Mantém grupo ativado ao zerar");

  rank.resetGlobalRank();
  assertEqual(rank.rankGlobal().length, 0, "Zera ranking global");
  assert(rank.isRankEnabled(groupB), "Mantém grupos ativados ao zerar global");
}

function testRecentMediaCache() {
  console.log("\n[8] Cache de última mídia");
  const { _private } = require("./lib/bot");
  const msg = { key: { id: "media-1" }, message: { imageMessage: {} } };
  const media = _private.getMedia(msg.message);

  _private.rememberMedia("chat-cache", msg, media, 1000);

  const recent = _private.getRecentMedia("chat-cache", 2000);
  assert(recent, "Recupera mídia recente");
  assertEqual(recent.msg.key.id, "media-1", "Mídia recuperada é a correta");

  const expired = _private.getRecentMedia("chat-cache", 1000 + 6 * 60 * 1000);
  assert(!expired, "Expira mídia antiga");
}

function testConverterHelpers() {
  console.log("\n[9] Tentativas de vídeo");
  const { _private } = require("./lib/stickerConverter");
  const attempts = _private.buildVideoAttempts();

  assert(attempts.length > 0, "Gera tentativas de compressão");
  assert(attempts.some((item) => item.duration < 6), "Inclui cortes menores");
  assert(attempts.some((item) => item.size < 512), "Inclui reduções de tamanho");
  assert(attempts.every((item) => item.size === item.size), "Mantém saída quadrada");

  const source = _private.buildVideoFilter({ fps: 15, size: 512 });
  assert(source.includes("scale=512:512"), "Vídeo achata para 512x512");
  assert(!source.includes("crop="), "Vídeo não recorta");

  const exif = _private.createStickerExif();
  assert(exif.includes(Buffer.from("bot do @tomm")), "EXIF contém autor");
  assert(exif.includes(Buffer.from("Figurinhas do bot")), "EXIF contém pacote");

  const tinyWebp = Buffer.concat([
    Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "binary"),
    Buffer.from([10, 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x02, 0x00, 0x02]),
  ]);
  tinyWebp.writeUInt32LE(tinyWebp.length - 8, 4);
  const withExif = _private.insertWebpChunk(tinyWebp, "EXIF", exif);
  assertEqual(withExif.toString("ascii", 12, 16), "VP8X", "Insere VP8X antes de EXIF");
  assert((withExif[20] & 0x08) === 0x08, "VP8X declara EXIF");
}

async function testServer() {
  console.log("\n[10] Servidor QR");
  const { startServer } = require("./lib/server");
  const server = await startServer(0, () => ({ currentQR: null, status: "waiting" }));

  assert(server && typeof server.close === "function", "Servidor inicia e retorna instância");
  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  console.log("=== Testes do Sticker Bot ===");

  await testImageConversion();
  await testVideoConversion();
  testConfig();
  testBotHelpers();
  await testRankCommandOutsideGroup();
  testMediaParsing();
  testRankHelpers();
  testRecentMediaCache();
  testConverterHelpers();
  await testServer();

  console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam, ${skipped} pulados ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
