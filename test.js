const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { DisconnectReason } = require("@whiskeysockets/baileys");
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
  const { imageToSticker, replaceStickerMetadata, stickerToImage, _private } = require("./lib/stickerConverter");

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
  const signature = "[ DONO ] : ╳ T00M4ZIOW BOT ╳\n[ INSTA ]: @tomaziow";
  const serializedSignature = signature.replace("\n", "\\n");
  assert(output.includes(Buffer.from(serializedSignature)), "Imagem inclui assinatura em duas linhas");
  assertEqual(output.toString("ascii", 12, 16), "VP8X", "Imagem declara VP8X");
  assert((output[20] & 0x08) === 0x08, "Imagem declara flag EXIF");

  const foreignSticker = _private.addStickerMetadata(output, {
    packId: "pacote-alheio",
    packname: "PACOTE ALHEIO",
    author: "OUTRO AUTOR",
  });
  const stolenSticker = replaceStickerMetadata(foreignSticker);
  assert(stolenSticker.includes(Buffer.from(serializedSignature)), ".roubar grava assinatura em duas linhas");
  assert(!stolenSticker.includes(Buffer.from("PACOTE ALHEIO")), ".roubar remove nome do pacote anterior");
  assert(!stolenSticker.includes(Buffer.from("OUTRO AUTOR")), ".roubar remove autor anterior");

  const convertedBack = await stickerToImage(output);
  const convertedMeta = await sharp(convertedBack).metadata();
  assertEqual(convertedMeta.format, "png", "Figurinha vira PNG");

  const striped = await sharp({
    create: {
      width: 100,
      height: 200,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: { r: 0, g: 255, b: 0 },
          },
        }).png().toBuffer(),
        top: 50,
        left: 0,
      },
      {
        input: await sharp({
          create: {
            width: 100,
            height: 50,
            channels: 3,
            background: { r: 0, g: 0, b: 255 },
          },
        }).png().toBuffer(),
        top: 150,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const cropped = await stickerToImage(await imageToSticker(striped, { crop: true }));
  const topPixel = await sharp(cropped)
    .extract({ left: 256, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert(topPixel[1] > topPixel[0] && topPixel[1] > topPixel[2], ".figcrop recorta sem achatar");
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
    assert(output.includes(Buffer.from("[ INSTA ]: @tomaziow")), "Vídeo inclui Instagram no metadata");
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
  }
}

async function testTextStickerConversion() {
  console.log("\n[3] Texto para figurinha");
  const { rgbTextToSticker, textToSticker, _private } = require("./lib/stickerConverter");

  const output = await textToSticker("Olá mundo");
  const meta = await sharp(output).metadata();

  assertEqual(meta.width, 512, "Texto fica com largura 512");
  assertEqual(meta.height, 512, "Texto fica com altura 512");
  assertEqual(meta.format, "webp", "Texto vira WebP");
  assert(output.includes(Buffer.from("[ INSTA ]: @tomaziow")), "Texto inclui Instagram no metadata");
  assertEqual(_private.escapeXml("<oi>"), "&lt;oi&gt;", "Texto escapa XML");
  assertEqual(_private.sanitizeStickerText("   "), "t00m4ziow", "Texto vazio usa fallback");
  assert(_private.wrapStickerText("essa frase grande precisa quebrar").length > 1, "Texto grande quebra linhas");
  assert(!_private.createTextStickerSvg("RGB", { rgb: true }).includes("#050510"), "RGB não usa fundo escuro");
  assert(!_private.createTextStickerSvg("RGB", { rgb: true }).includes("<circle"), "RGB não usa decoração de fundo");

  try {
    const rgb = await rgbTextToSticker("RGB");
    const rgbMeta = await sharp(rgb, { animated: true }).metadata();
    assertEqual(rgbMeta.format, "webp", "RGB vira WebP");
    assert(rgbMeta.pages > 1, "RGB gera sticker animado");
    assert(rgb.includes(Buffer.from("[ INSTA ]: @tomaziow")), "RGB inclui Instagram no metadata");
  } catch {
    skip("ffmpeg indisponível; teste de figtxt rgb pulado");
  }
}

async function testAudioConversion() {
  console.log("\n[4] Áudio");
  const { convertAudio, getAudioEffectByCommand } = require("./lib/audioConverter");
  const inputPath = path.join(os.tmpdir(), `audio-test-${Date.now()}.wav`);

  try {
    execFileSync("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "sine=frequency=440:duration=2",
      inputPath,
    ], { stdio: "ignore" });
  } catch {
    skip("ffmpeg indisponível; teste de áudio pulado");
    return;
  }

  try {
    assertEqual(getAudioEffectByCommand(".vozgrave", config.commands.audioEffects), "deepVoice", ".vozgrave reconhecido");
    assertEqual(getAudioEffectByCommand(" .VOZFINA ", config.commands.audioEffects), "thinVoice", ".vozfina case-insensitive");
    assertEqual(getAudioEffectByCommand(".veloz", config.commands.audioEffects), "fastAudio", ".veloz reconhecido");
    assertEqual(getAudioEffectByCommand(".lento", config.commands.audioEffects), "slowAudio", ".lento reconhecido");

    const output = await convertAudio(fs.readFileSync(inputPath), "fastAudio");
    assert(output.length > 0, "Áudio convertido tem conteúdo");

    const outputPath = path.join(os.tmpdir(), `audio-test-out-${Date.now()}.ogg`);
    try {
      fs.writeFileSync(outputPath, output);
      const format = execFileSync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=format_name",
        "-of", "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ], { encoding: "utf8" }).trim();
      assert(format.includes("ogg"), "Áudio convertido vira OGG");
    } finally {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
  }
}

function testConfig() {
  console.log("\n[5] Configuração");
  const config = require("./config");

  assert(config.commands.sticker.includes(".fig"), "Comando .fig ativo");
  assert(config.commands.sticker.includes(".sticker"), "Comando .sticker ativo");
  assertEqual(config.commands.ai, ".ia", "Comando .ia ativo");
  assertEqual(config.commands.aiOn, ".iaon", "Comando .iaon ativo");
  assertEqual(config.commands.aiOff, ".iaoff", "Comando .iaoff ativo");
  assertEqual(config.commands.stickerCrop, ".figcrop", "Comando .figcrop ativo");
  assertEqual(config.commands.stealSticker, ".roubar", "Comando .roubar ativo");
  assertEqual(config.commands.pinterestSticker, ".figpin", "Comando .figpin ativo");
  assertEqual(config.bot.maxPinterestLinks, 5, "Limite de links Pinterest");
  assertEqual(config.commands.menu, ".menu", "Comando de menu");
  assertEqual(config.commands.devMenu, ".menudev", "Comando de menu dev");
  assertEqual(config.commands.textSticker, ".figtxt", "Comando .figtxt ativo");
  assertEqual(config.commands.raffle, ".sorteio", "Comando .sorteio ativo");
  assertEqual(config.commands.daily, ".daily", "Comando .daily ativo");
  assertEqual(config.commands.roulette, ".roleta", "Comando .roleta ativo");
  assertEqual(config.commands.rouletteDev, ".roletadev", "Comando .roletadev ativo");
  assertEqual(config.commands.level, ".level", "Comando .level ativo");
  assertEqual(config.commands.topLevel, ".toplevel", "Comando .toplevel ativo");
  assertEqual(config.commands.achievements, ".conquistas", "Comando .conquistas ativo");
  assertEqual(config.commands.profile, ".perfil", "Comando .perfil ativo");
  assertEqual(config.commands.xboxDeals, ".xboxpromo", "Comando .xboxpromo ativo");
  assertEqual(config.commands.ai, ".ia", "Comando .ia ativo");
  assertEqual(config.commands.shop, ".loja", "Comando .loja ativo");
  assertEqual(config.commands.errors, ".erros", "Comando .erros ativo");
  assertEqual(config.commands.maintenance, ".manutencao", "Comando .manutencao ativo");
  assertEqual(config.commands.restart, ".reiniciar", "Comando .reiniciar ativo");
  assertEqual(config.commands.deleteMessages, ".apagarmsg", "Comando .apagarmsg ativo");
  assertEqual(config.personalBot, undefined, "Bot pessoal removido");
  assertEqual(config.shop.tags.length, 11, "Loja tem 11 tags");
  assertEqual(new Set(config.shop.tags.filter((tag) => !tag.locked).map((tag) => tag.price)).size, 10, "Tags compráveis têm preços diferentes");
  assertEqual(config.shop.tags.find((tag) => tag.id === "vulto").price, 1000, "Primeira tag custa 1000 pts");
  assertEqual(config.shop.tags.find((tag) => tag.id === "entidade").price, 70000, "Última tag custa 70000 pts");
  assert(config.shop.tags.find((tag) => tag.id === "dev").hiddenFromShop, "Tag DEV fica oculta da loja");
  assert(config.shop.tags.find((tag) => tag.id === "entidade").price > config.shop.tags.find((tag) => tag.id === "vulto").price, "Tags avançadas são mais caras");
  assertEqual(config.daily.basePoints, 20, "Daily base configurado");
  assert(config.roulette.prizes.some((prize) => prize.id === "100" && prize.points === 100), "Roleta tem prêmio de 100 pontos");
  assertEqual(config.shop.tags.find((tag) => tag.id === "entidade").dailyBonus, 1.2, "Tag mais cara dá bônus maior");
  assert(config.profileThemes.some((theme) => theme.id === "t00m" && theme.locked), "Tema exclusivo configurado");
  assertEqual(config.bot.allowSelfMessages, true, "Permite testar consigo mesmo");
  assertEqual(config.sticker.size, 512, "Sticker base 512");
  assertEqual(config.sticker.maxSizeKB, 500, "Limite 500KB");
  assertEqual(config.sticker.packname, "[ DONO ] : ╳ T00M4ZIOW BOT ╳\n[ INSTA ]: @tomaziow", "Assinatura do sticker tem duas linhas");
  assertEqual(config.sticker.author, "", "Autor separado fica vazio");
  assertEqual(config.ai.cooldownMs, 2000, "Cooldown da IA em 2 segundos");
  assertEqual(config.commands.audioEffects.deepVoice, ".vozgrave", "Comando .vozgrave ativo");
  assertEqual(config.commands.audioEffects.thinVoice, ".vozfina", "Comando .vozfina ativo");
  assertEqual(config.commands.audioEffects.fastAudio, ".veloz", "Comando .veloz ativo");
  assertEqual(config.commands.audioEffects.slowAudio, ".lento", "Comando .lento ativo");
  assert(config.bot.reconnectMinMs > 0, "Reconexão mínima configurada");
  assert(config.bot.reconnectMaxMs >= config.bot.reconnectMinMs, "Reconexão máxima configurada");
  assert(config.xboxDeals.url.includes("xbox.com/pt-BR"), "Xbox promo usa região Brasil");
  assert(config.xboxDeals.cacheMs > 0, "Xbox promo usa cache");
  assert(config.ai.endpoint.includes("integrate.api.nvidia.com"), "IA usa endpoint NVIDIA");
  assert(config.ai.maxPromptChars > 0, "IA limita prompt");
  assertEqual(config.ai.model, "meta/llama-3.1-8b-instruct", "IA usa modelo rápido e mais inteligente");
}

async function testBotHelpers() {
  console.log("\n[6] Bot e comandos");
  const { getState, startBot, _private } = require("./lib/bot");

  assert(typeof startBot === "function", "startBot exportado");
  assert(typeof getState === "function", "getState exportado");
  assert(_private.isMenuCommand(" .MENU "), ".menu é case-insensitive");
  assert(_private.isDevMenuCommand(" .MENUDEV "), ".menudev é case-insensitive");
  assert(_private.isStickerCommand(" .FIG "), ".fig é case-insensitive");
  assert(_private.isStickerCommand(".sticker"), ".sticker funciona");
  assert(_private.isStickerCropCommand(" .FIGCROP "), ".figcrop é case-insensitive");
  assert(_private.isAnyStickerCommand(".figcrop"), ".figcrop também cria figurinha");
  assert(_private.isStealStickerCommand(" .ROUBAR "), ".roubar é case-insensitive");
  assert(!_private.isStealStickerCommand(".roubar agora"), ".roubar exige comando exato");
  assertEqual(_private.parsePinterestStickerCommand(".figpin https://pin.it/abc").type, "pin", ".figpin reconhecido");
  assertEqual(_private.parsePinterestStickerCommand(".figpin https://pin.it/1 https://pin.it/2").urls.length, 2, ".figpin aceita vários links");
  assertEqual(_private.parsePinterestStickerCommand(".figpin https://pin.it/1 https://pin.it/2 https://pin.it/3 https://pin.it/4 https://pin.it/5 https://pin.it/6").urls.length, 5, ".figpin limita links");
  assertEqual(_private.parsePinterestStickerCommand(".figpin https://pin.it/1 https://pin.it/2 https://pin.it/3 https://pin.it/4 https://pin.it/5 https://pin.it/6").ignored, 1, ".figpin conta links ignorados");
  assertEqual(_private.parsePinterestStickerCommand(".figpin").type, "invalid", ".figpin exige link");
  assert(_private.isPinterestUrl("https://br.pinterest.com/pin/123"), "Reconhece link Pinterest");
  assert(_private.isPinterestUrl("https://pin.it/abc"), "Reconhece link curto Pinterest");
  assert(!_private.isPinterestUrl("https://example.com/a"), "Recusa link fora do Pinterest");
  assertEqual(_private.getMediaTypeFromContentType("image/jpeg; charset=utf-8"), "image", "Detecta content-type imagem");
  assertEqual(_private.getMediaTypeFromContentType("video/mp4"), "video", "Detecta content-type vídeo");
  assertEqual(_private.extractPinterestMediaUrl('<meta property="og:image" content="https://i.pinimg.com/x.jpg">'), "https://i.pinimg.com/x.jpg", "Extrai imagem do Pinterest");
  assert(_private.isProfileStickerCommand(".figpp @teste"), ".figpp reconhecido");
  assertEqual(_private.parseTextStickerCommand(".figtxt olá").type, "static", ".figtxt reconhecido");
  assertEqual(_private.parseTextStickerCommand(".figtxt olá").text, "olá", ".figtxt preserva texto");
  assertEqual(_private.parseTextStickerCommand(".figtxt rgb olá").type, "rgb", ".figtxt rgb reconhecido");
  assertEqual(_private.parseTextStickerCommand(".figtxt").type, "missing", ".figtxt sem texto pede uso");
  assertEqual(_private.parseTextStickerCommand(".figtxt rgb").type, "static", ".figtxt rgb sem texto vira texto normal");
  assert(_private.isToImageCommand(".toimg"), ".toimg reconhecido");
  assert(!_private.isToImageCommand(".toimg teste"), ".toimg exige comando exato");
  assert(!_private.isPersonalCommandLike("!fig"), "Bot completo não reserva prefixo pessoal");
  assert(!_private.isPersonalCommandLike(".fig"), "Bot completo não confunde ponto com pessoal");
  assert(_private.isStatusBotCommand(".statusbo"), ".statusbo reconhecido");
  assert(!_private.isStatusBotCommand(".statusbo teste"), ".statusbo exige comando exato");
  assert(_private.isRaffleCommand(".sorteio"), ".sorteio reconhecido");
  assert(!_private.isRaffleCommand(".sorteio teste"), ".sorteio exige comando exato");
  assert(_private.isDailyCommand(".daily"), ".daily reconhecido");
  assert(!_private.isDailyCommand(".daily teste"), ".daily exige comando exato");
  assert(_private.isRouletteCommand(".roleta"), ".roleta reconhecido");
  assert(!_private.isRouletteCommand(".roleta teste"), ".roleta exige comando exato");
  assert(_private.isRouletteDevCommand(".roletadev"), ".roletadev reconhecido");
  assert(!_private.isRouletteDevCommand(".roletadev teste"), ".roletadev exige comando exato");
  assertEqual(_private.parseLevelCommand(".level").type, "level", ".level reconhecido");
  assertEqual(_private.parseLevelCommand(".level Ana").query, "Ana", ".level aceita alvo");
  assertEqual(_private.parseLevelCommand(".toplevel").type, "topLevel", ".toplevel reconhecido");
  assertEqual(_private.parseLevelCommand(".toplevel teste").type, "invalid", ".toplevel exige comando exato");
  assertEqual(_private.parseLevelCommand(".conquistas").type, "achievements", ".conquistas reconhecido");
  assert(_private.isProfileCommand(".perfil"), ".perfil reconhecido");
  assertEqual(_private.parseProfileCommand(".perfil").type, "show", ".perfil mostra perfil");
  assertEqual(_private.parseProfileCommand(".perfil temas").type, "themes", ".perfil temas mostra loja");
  assertEqual(_private.parseProfileCommand(".perfil comprar neon").type, "buyTheme", ".perfil comprar compra tema");
  assertEqual(_private.parseProfileCommand(".perfil tema neon").type, "equipTheme", ".perfil tema equipa tema");
  assertEqual(_private.parseProfileCommand(".perfil teste").type, "invalid", ".perfil inválido");
  assertEqual(_private.parseXboxDealsCommand(".xboxpromo").type, "deals", ".xboxpromo reconhecido");
  assertEqual(_private.parseXboxDealsCommand(".xboxpromo").limit, 20, ".xboxpromo mostra 20 jogos");
  assertEqual(_private.parseXboxDealsCommand(".xboxpromo 10").type, "invalid", ".xboxpromo não aceita limite");
  assertEqual(_private.parseXboxDealsCommand(".xboxpromo teste").type, "invalid", ".xboxpromo valida argumentos");
  assertEqual(_private.parseAiCommand(".ia olá bot").type, "ask", ".ia reconhecido");
  assertEqual(_private.parseAiCommand(".ia").type, "missing", ".ia exige texto");
  assertEqual(_private.parseAiControlCommand(".iaon").action, "on", ".iaon reconhecido");
  assertEqual(_private.parseAiControlCommand(".iaoff").action, "off", ".iaoff reconhecido");
  assertEqual(_private.parseAiControlCommand(".iaoff").silent, false, ".iaoff avisa usuários");
  assertEqual(_private.parseAiControlCommand(".iaoff nologs").action, "off", ".iaoff nologs reconhecido");
  assertEqual(_private.parseAiControlCommand(".iaoff nologs").silent, true, ".iaoff nologs silencia aviso");
  assertEqual(_private.parseAiControlCommand(".iaoff agora").action, "invalid", ".iaoff valida argumentos");
  assertEqual(_private.parseDevAssetCommand(".devtag dar @ana dev").type, "grant", ".devtag dar reconhecido");
  assertEqual(_private.parseDevAssetCommand(".devtag tirar @ana dev").type, "revoke", ".devtag tirar reconhecido");
  assertEqual(_private.parseDevAssetCommand(".devtema usar @ana t00m").asset, "theme", ".devtema reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel dar @ana 100").type, "add", ".devlevel dar reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel tirar @ana 50").type, "remove", ".devlevel tirar reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel setar @ana 500").type, "set", ".devlevel setar reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel resetar @ana").type, "reset", ".devlevel resetar reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel resetgrupo").type, "resetGroup", ".devlevel resetgrupo reconhecido");
  assertEqual(_private.parseDevLevelCommand(".devlevel resetgrupo agora").type, "invalid", ".devlevel resetgrupo exige comando exato");
  assert(_private.isErrorsCommand(".erros"), ".erros reconhecido");
  assert(!_private.isErrorsCommand(".erros teste"), ".erros exige comando exato");
  assert(_private.isRestartCommand(".reiniciar"), ".reiniciar reconhecido");
  assert(!_private.isRestartCommand(".reiniciar teste"), ".reiniciar exige comando exato");
  assertEqual(_private.parseDeleteMessagesCommand(".apagarmsg 5").amount, 5, ".apagarmsg reconhecido");
  assertEqual(_private.parseDeleteMessagesCommand(".apagarmsg 0").type, "invalid", ".apagarmsg exige mínimo");
  assertEqual(_private.parseDeleteMessagesCommand(".apagarmsg 31").type, "invalid", ".apagarmsg limita quantidade");
  assertEqual(_private.parseMaintenanceCommand(".manutencao on").action, "on", ".manutencao on reconhecido");
  assertEqual(_private.parseMaintenanceCommand(".manutencao off").action, "off", ".manutencao off reconhecido");
  assertEqual(_private.parseMaintenanceCommand(".manutencao off nologs").action, "invalid", ".manutencao off nologs é inválido");
  assertEqual(_private.parseMaintenanceCommand(".manutencao on nologs").action, "on", ".manutencao on nologs ativa silenciosa");
  assertEqual(_private.parseMaintenanceCommand(".manutencao on nologs").silent, true, ".manutencao on nologs silencia aviso");
  assertEqual(_private.parseMaintenanceCommand(".manutencao").action, "status", ".manutencao mostra status");
  assertEqual(_private.parseMaintenanceCommand(".manutencao teste").action, "invalid", ".manutencao inválido");
  assert(!_private.shouldClearSessionForDisconnect(DisconnectReason.loggedOut), "loggedOut preserva sessão local");
  assert(!_private.shouldClearSessionForDisconnect(DisconnectReason.badSession), "badSession preserva sessão local");
  assert(!_private.shouldClearSessionForDisconnect(DisconnectReason.connectionClosed), "connectionClosed preserva sessão válida");
  assertEqual(_private.getAudioEffectCommand(".vozgrave"), "deepVoice", ".vozgrave reconhecido");
  assertEqual(_private.getAudioEffectCommand(".vozgrave teste"), null, ".vozgrave exige comando exato");
  assert(_private.MENU_TEXT.includes(".vozgrave"), "Menu mostra vozgrave");
  assert(_private.MENU_TEXT.includes(".vozfina"), "Menu mostra vozfina");
  assert(_private.MENU_TEXT.includes(".veloz"), "Menu mostra veloz");
  assert(_private.MENU_TEXT.includes(".lento"), "Menu mostra lento");
  assert(!_private.MENU_TEXT.includes("Página 1/"), "Menu não mostra paginação");
  assert(!_private.MENU_TEXT.includes("Use ⬅️ ➡️"), "Menu não mostra controles de reação");
  assert(!_private.shouldIgnoreMessage({ key: { fromMe: true, remoteJid: "me@s.whatsapp.net" } }), "Não ignora mensagens próprias");
  _private.rememberBotSentMessage({ key: { id: "bot-response-1" } });
  assert(_private.isBotSentMessage({ key: { id: "bot-response-1" } }), "Identifica resposta enviada pelo bot");
  assert(!_private.isBotSentMessage({ key: { id: "manual-message-1" } }), "Não marca mensagem manual como resposta do bot");
  assertEqual(_private.getReplyOptions({ key: { id: "cmd-1" } }).quoted.key.id, "cmd-1", "Resposta cita mensagem do comando");
  assertEqual(_private.getReplyOptions(null), undefined, "Resposta sem comando não força citação");
  const sentCalls = [];
  _private.setSockForTests({
    sendMessage: async (chatId, message, options) => {
      sentCalls.push({ chatId, message, options });
      if (options?.quoted) throw new Error("quote falhou");
      return { key: { id: `fallback-${sentCalls.length}` } };
    },
  });
  await _private.sendMessageWithFallback("grupo@g.us", { text: "oi" }, _private.getReplyOptions({ key: { id: "cmd-quote" } }), "teste");
  assertEqual(sentCalls.length, 2, "Fallback tenta enviar solto quando quote falha");
  assertEqual(sentCalls[1].options, undefined, "Fallback remove quote na segunda tentativa");
  _private.setSockForTests(null);
  assert(_private.shouldIgnoreMessage({ key: { remoteJid: "status@broadcast" } }), "Ignora status");
  assert(_private.shouldIgnoreMessage({ key: { remoteJid: "120363@newsletter" } }), "Ignora canais/newsletters");
  assert(!_private.MENU_TEXT.includes(".zerarrank"), "Menu não mostra zerarrank");
  assert(!_private.MENU_TEXT.includes(".removerank"), "Menu não mostra removerank");
  assert(!_private.MENU_TEXT.includes(".statusbo"), "Menu não mostra statusbo");
  assert(!_private.MENU_TEXT.includes(".menudev"), "Menu não mostra menudev");
  assert(!_private.MENU_TEXT.includes(".iaon"), "Menu não mostra iaon");
  assert(!_private.MENU_TEXT.includes(".iaoff"), "Menu não mostra iaoff");
  assert(!_private.MENU_TEXT.includes(".erros"), "Menu não mostra erros");
  assert(!_private.MENU_TEXT.includes(".manutencao"), "Menu não mostra manutenção");
  assert(!_private.MENU_TEXT.includes(".reiniciar"), "Menu não mostra reiniciar");
  assert(!_private.MENU_TEXT.includes(".devtag"), "Menu não mostra devtag");
  assert(!_private.MENU_TEXT.includes(".devtema"), "Menu não mostra devtema");
  assert(!_private.MENU_TEXT.includes("╳ T00M4ZIOW BOT ╳"), "Menu não mostra assinatura");
  assert(_private.DEV_MENU_TEXT.includes(".menudev"), "Menu dev mostra menudev");
  assert(_private.DEV_MENU_TEXT.includes(".statusbo"), "Menu dev mostra statusbo");
  assert(_private.DEV_MENU_TEXT.includes(".erros"), "Menu dev mostra erros");
  assert(_private.DEV_MENU_TEXT.includes(".manutencao on/off/status"), "Menu dev mostra manutenção");
  assert(_private.DEV_MENU_TEXT.includes(".manutencao on nologs"), "Menu dev mostra manutenção silenciosa");
  assert(_private.DEV_MENU_TEXT.includes(".iaon"), "Menu dev mostra iaon");
  assert(_private.DEV_MENU_TEXT.includes(".iaoff"), "Menu dev mostra iaoff");
  assert(_private.DEV_MENU_TEXT.includes(".iaoff nologs"), "Menu dev mostra iaoff nologs");
  assert(_private.DEV_MENU_TEXT.includes(".reiniciar"), "Menu dev mostra reiniciar");
  assert(!_private.DEV_MENU_TEXT.includes(".apagarmsg"), "Menu dev não mostra apagarmsg");
  assert(_private.DEV_MENU_TEXT.includes(".zerarrank global"), "Menu dev mostra zerarrank global");
  assert(_private.DEV_MENU_TEXT.includes(".removerank <nome/id>"), "Menu dev mostra removerank");
  assert(_private.DEV_MENU_TEXT.includes(".roletadev"), "Menu dev mostra roleta dev");
  assert(_private.DEV_MENU_TEXT.includes(".devlevel dar @user <xp>"), "Menu dev mostra gerenciar level");
  assert(_private.DEV_MENU_TEXT.includes(".devlevel resetgrupo"), "Menu dev mostra reset level do grupo");
  assert(_private.DEV_MENU_TEXT.includes("✦ TAGS"), "Menu dev agrupa tags");
  assert(_private.DEV_MENU_TEXT.includes("✦ TEMAS"), "Menu dev agrupa temas");
  assert(_private.DEV_MENU_TEXT.includes(".devtag dar @user <tag>"), "Menu dev mostra gerenciar tags");
  assert(_private.DEV_MENU_TEXT.includes(".devtema dar @user <tema>"), "Menu dev mostra gerenciar temas");
  assert(_private.DEV_MENU_TEXT.includes("status, memória e uptime"), "Menu dev explica statusbo");
  assert(_private.DEV_MENU_TEXT.includes("zera só o grupo atual"), "Menu dev explica zerarrank");
  assert(!_private.DEV_MENU_TEXT.includes(".fig\n"), "Menu dev não mostra comando do menu normal");
  assert(!_private.DEV_MENU_TEXT.includes(".rank\n"), "Menu dev não mostra rank normal");
  assert(!_private.DEV_MENU_TEXT.includes("╳ T00M4ZIOW BOT ╳"), "Menu dev não mostra assinatura");
  assert(_private.MENU_TEXT.includes(".perfil"), "Menu mostra perfil");
  assert(_private.MENU_TEXT.includes(".perfil temas"), "Menu mostra temas do perfil");
  assert(_private.MENU_TEXT.includes(".figpp"), "Menu mostra figpp");
  assert(_private.MENU_TEXT.includes(".figcrop"), "Menu mostra figcrop");
  assert(_private.MENU_TEXT.includes(".roubar"), "Menu mostra roubar figurinha");
  assert(_private.MENU_TEXT.includes(".figtxt <texto>"), "Menu mostra figtxt");
  assert(_private.MENU_TEXT.includes(".figtxt rgb <texto>"), "Menu mostra figtxt rgb");
  assert(_private.MENU_TEXT.includes(".toimg"), "Menu mostra toimg");
  assert(_private.MENU_TEXT.includes(".sorteio"), "Menu mostra sorteio");
  assert(_private.MENU_TEXT.includes(".xboxpromo"), "Menu mostra xboxpromo");
  assert(_private.MENU_TEXT.includes(".ia <texto>"), "Menu mostra ia");
  assert(_private.MENU_TEXT.includes(".daily"), "Menu mostra daily");
  assert(_private.MENU_TEXT.includes(".roleta"), "Menu mostra roleta");
  assert(!_private.MENU_TEXT.includes(".roletadev"), "Menu normal não mostra roletadev");
  assert(_private.MENU_TEXT.includes(".level"), "Menu mostra level");
  assert(_private.MENU_TEXT.includes(".conquistas"), "Menu mostra conquistas");
  assert(_private.MENU_TEXT.includes(".toplevel"), "Menu mostra toplevel");
  assert(!_private.MENU_TEXT.includes(".audio2txt"), "Menu não mostra audio2txt");
  assert(_private.MENU_TEXT.includes(".loja"), "Menu mostra loja");
  assert(_private.MENU_TEXT.includes(".comprar <tag>"), "Menu mostra comprar tag");
  assert(!_private.MENU_TEXT.includes("Teste consigo mesmo"), "Menu não mostra teste consigo mesmo");
  assert(!_private.MENU_TEXT.includes("Formas de usar"), "Menu não mostra formas de usar");
  assert(!_private.MENU_TEXT.includes("Vídeos"), "Menu não mostra seção de vídeo");
  assert(!_private.MENU_TEXT.includes("FORMATO"), "Menu não mostra seção formato");
  assertEqual(_private.normalizeUserJid("551199999999:12@s.whatsapp.net"), "551199999999@s.whatsapp.net", "Normaliza JID do próprio bot");
  assertEqual(_private.formatBytes(10 * 1024 * 1024), "10.0 MB", "Formata memória");
  assertEqual(_private.formatDuration(65000), "1min 5s", "Formata uptime");
  assertEqual(_private.formatMention("551199999999@s.whatsapp.net"), "@551199999999", "Formata menção do sorteio");
  assertEqual(_private.normalizePhoneJid("551188887777:12@s.whatsapp.net"), "551188887777@s.whatsapp.net", "Normaliza telefone para sorteio");
  assertEqual(_private.normalizePhoneJid("123456789@lid"), "", "Ignora LID no sorteio");
  assertEqual(_private.getRaffleParticipantJid({ id: "abc@lid", phoneNumber: "+55 11 8888-7777" }), "551188887777@s.whatsapp.net", "Usa telefone real quando participante tem LID");
  assertEqual(_private.getRaffleParticipants({
    participants: [
      { id: "551111111111@s.whatsapp.net" },
      { jid: "552222222222@s.whatsapp.net" },
      { id: "123456789@lid" },
      { id: "abc@lid", phoneNumber: "+55 33 3333-3333" },
      { id: "120363000000@g.us" },
    ],
  }).length, 3, "Lista apenas participantes reais do sorteio");
  assert(_private.formatStatusBot().includes("Manutenção:"), "Status mostra manutenção");
  assert(_private.formatStatusBot().includes("IA:"), "Status mostra estado da IA");
  assert(_private.handleAiControlCommand({ action: "off", silent: false }).includes("desativada"), "Desliga IA com aviso");
  assert(_private.formatStatusBot().includes("IA: desativada"), "Status mostra IA desligada");
  assert(_private.handleAiControlCommand({ action: "off", silent: true }).includes("silencioso"), "Desliga IA silenciosa");
  assert(_private.formatStatusBot().includes("IA: desativada silenciosa"), "Status mostra IA silenciosa");
  assert(_private.handleAiControlCommand({ action: "on" }).includes("ativada"), "Liga IA");
  _private.resetAiControlForTests();
  assert(_private.formatRecentErrors().includes("Últimos erros/logs"), ".erros formata logs");
  assert(_private.handleMaintenanceCommand({ action: "on" }).includes("ativada"), "Liga manutenção");
  assert(_private.shouldBlockForMaintenance({ key: { fromMe: false } }, ".menu", null), "Manutenção bloqueia comando de terceiros");
  assert(_private.shouldBlockForMaintenance({ key: { fromMe: false } }, "", { caption: ".fig" }), "Manutenção bloqueia comando na legenda");
  assert(!_private.shouldBlockForMaintenance({ key: { fromMe: false } }, "oi", null), "Manutenção não responde mensagem comum");
  assert(!_private.shouldBlockForMaintenance({ key: { fromMe: true } }, ".menu", null), "Manutenção não bloqueia dono");
  assert(_private.formatMaintenanceBlockMessage().includes("manutenção"), "Aviso informa manutenção");
  assert(_private.handleMaintenanceCommand({ action: "off" }).includes("desativada"), "Desliga manutenção");
  assert(!_private.shouldBlockForMaintenance({ key: { fromMe: false } }, ".menu", null), "Sem manutenção não bloqueia comando");
  assert(_private.handleMaintenanceCommand({ action: "on", silent: true }).includes("silencioso"), "Liga manutenção silenciosa");
  assert(_private.shouldBlockForMaintenance({ key: { fromMe: false } }, ".menu", null), "Manutenção silenciosa bloqueia comando");
  assertEqual(_private.formatMaintenanceBlockMessage(), "", "Manutenção silenciosa não avisa");
  assert(_private.formatStatusBot().includes("Manutenção: ativada silenciosa"), "Status mostra manutenção silenciosa");
  _private.resetMaintenanceForTests();
  _private.rememberRecentMessage({ key: { remoteJid: "grupo-delete@g.us", id: "msg-1", participant: "a@s.whatsapp.net" } });
  _private.rememberRecentMessage({ key: { remoteJid: "grupo-delete@g.us", id: "msg-2", participant: "b@s.whatsapp.net" } });
  _private.rememberRecentMessage({ key: { remoteJid: "grupo-delete@g.us", id: "cmd-delete", fromMe: true } });
  assertEqual(_private.getRecentMessageKeys("grupo-delete@g.us", 2, "cmd-delete").map((key) => key.id).join(","), "msg-2,msg-1", ".apagarmsg seleciona últimas mensagens sem o comando");
}

function testXboxDealsHelpers() {
  console.log("\n[12] Xbox promo");
  const xboxDeals = require("./lib/xboxDeals");

  const state = {
    core2: {
      channels: {
        channelData: {
          "BROWSE_CHANNELID=DYNAMICCHANNEL.GAMEDEALS_FILTERS=": {
            data: {
              products: [
                { productId: "GAME1" },
                { productId: "GAME2" },
                { productId: "FREE1" },
              ],
            },
          },
        },
      },
      products: {
        productSummaries: {
          GAME1: {
            productId: "GAME1",
            title: "Jogo Barato",
            specificPrices: {
              purchaseable: [{
                listPrice: 19.99,
                msrp: 199.99,
                currency: "BRL",
                discountPercentage: 90,
                endDateUtc: "07/21/2026 09:59:59",
              }],
            },
          },
          GAME2: {
            productId: "GAME2",
            title: "Jogo Médio",
            specificPrices: {
              purchaseable: [{
                listPrice: 49.95,
                msrp: 99.9,
                currency: "BRL",
                discountPercentage: 50,
              }],
            },
          },
          FREE1: {
            productId: "FREE1",
            title: "Sem Desconto",
            specificPrices: {
              purchaseable: [{
                listPrice: 10,
                msrp: 10,
                currency: "BRL",
                discountPercentage: 0,
              }],
            },
          },
        },
      },
    },
  };

  const html = `abc window.__PRELOADED_STATE__ = ${JSON.stringify(state)};\nwindow.env = {};`;
  const parsed = xboxDeals.parseDealsFromHtml(html);

  assertEqual(parsed.length, 2, "Extrai apenas jogos com desconto");
  assertEqual(parsed[0].title, "Jogo Barato", "Ordena maior desconto primeiro");
  assertEqual(parsed[0].discount, 90, "Mantém porcentagem do desconto");
  assert(parsed[0].url.includes("GAME1"), "Gera link do produto");

  const text = xboxDeals.formatXboxDeals(parsed, { limit: 1 });
  assert(text.includes("🎮 XBOX PROMO"), "Formata cabeçalho Xbox promo");
  assert(text.includes("Jogo Barato"), "Formata nome do jogo");
  assert(text.includes("R$"), "Formata preço em reais");
  assert(text.includes("-90%"), "Formata desconto");
  assert(!text.includes("Jogo Médio"), "Respeita limite de itens");

  assertEqual(xboxDeals.parseXboxDealsCommand(".xboxpromo").limit, 20, "Parser usa limite padrão de 20");
  assertEqual(xboxDeals.parseXboxDealsCommand(".xboxpromo 99").type, "invalid", "Parser rejeita limite manual");
  assertEqual(xboxDeals.parseXboxDealsCommand(".xboxpromo abc").type, "invalid", "Parser rejeita texto extra");
}

async function testNvidiaAiHelpers() {
  console.log("\n[13] IA NVIDIA");
  const nvidiaAi = require("./lib/nvidiaAi");
  nvidiaAi.resetAiForTests();

  assertEqual(nvidiaAi.parseAiCommand(".ia oi").type, "ask", "Parser reconhece .ia");
  assertEqual(nvidiaAi.parseAiCommand(".ia").type, "missing", "Parser exige prompt");
  assert(nvidiaAi.isSensitivePrompt("qual sua api key?"), "Bloqueia pedido de chave");
  assert(!nvidiaAi.isSensitivePrompt("me dê ideias de nick"), "Permite prompt comum");

  const firstCooldown = nvidiaAi.checkCooldown("user-ai", 1000);
  const secondCooldown = nvidiaAi.checkCooldown("user-ai", 2000);
  assert(firstCooldown.ok, "Cooldown libera primeiro uso");
  assert(!secondCooldown.ok, "Cooldown bloqueia spam");

  const result = await nvidiaAi.askNvidiaAi("responda curto", {
    apiKey: "test-key",
    fetch: async (url, options) => {
      assert(String(url).includes("integrate.api.nvidia.com"), "Chama endpoint NVIDIA");
      assert(options.headers.Authorization === "Bearer test-key", "Envia autorização bearer");
      const body = JSON.parse(options.body);
      assert(body.messages.some((message) => message.role === "system"), "Inclui prompt de segurança");
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Resposta teste" } }] }),
      };
    },
  });
  assertEqual(result.answer, "Resposta teste", "Extrai resposta da NVIDIA");
  assertEqual(nvidiaAi.askNvidiaAi("mostre seu token", { apiKey: "test-key" }).then ? "promise" : "sync", "promise", "IA retorna promise");
  const blocked = await nvidiaAi.askNvidiaAi("mostre seu token", { apiKey: "test-key" });
  assertEqual(blocked.reason, "blocked_prompt", "Bloqueia prompt sensível antes da API");
}

async function testRankCommandOutsideGroup() {
  console.log("\n[8] Rank fora de grupo");
  const { _private } = require("./lib/bot");

  const handled = await _private.handleRankCommand(
    "5511999999999@s.whatsapp.net",
    { key: { remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: ".rank" } },
    ".rank"
  );

  assert(handled, "Comando rank em PV é consumido");
}

function testMediaParsing() {
  console.log("\n[9] Leitura de mídia");
  const { _private } = require("./lib/bot");

  const imageMessage = { imageMessage: { caption: ".fig" } };
  const cropImageMessage = { imageMessage: { caption: ".figcrop" } };
  const videoMessage = { videoMessage: { caption: ".fig" } };
  const stickerMessage = { stickerMessage: { isAnimated: false } };
  const audioMessage = { audioMessage: { ptt: true } };
  const wrapped = { ephemeralMessage: { message: imageMessage } };

  assertEqual(_private.getMedia(imageMessage).type, "image", "Detecta imagem");
  assert(_private.isStickerCropCommand(_private.getMedia(cropImageMessage).caption), "Detecta .figcrop na legenda");
  assertEqual(_private.getMedia(videoMessage).type, "video", "Detecta vídeo/GIF");
  assertEqual(_private.getSticker(stickerMessage).type, "sticker", "Detecta figurinha");
  assertEqual(_private.getAudio(audioMessage).type, "audio", "Detecta áudio");
  assert(_private.getAudio(audioMessage).isPtt, "Detecta áudio de voz");
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

  const quotedText = _private.getQuotedText({
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: ".ia responda essa mensagem",
        contextInfo: {
          stanzaId: "text-quoted-1",
          quotedMessage: { conversation: "com certeza ou concerteza?" },
        },
      },
    },
  });
  assertEqual(quotedText, "com certeza ou concerteza?", "Lê texto citado para IA");
  assert(_private.buildAiPrompt("responda", {
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: ".ia responda",
        contextInfo: {
          stanzaId: "text-quoted-2",
          quotedMessage: { conversation: "texto marcado" },
        },
      },
    },
  }).includes("Mensagem marcada:"), "IA monta prompt com mensagem marcada");

  const quotedSticker = _private.getQuotedSticker({
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: ".toimg",
        contextInfo: {
          stanzaId: "sticker-1",
          quotedMessage: stickerMessage,
        },
      },
    },
  });

  assert(quotedSticker, "Detecta figurinha respondida");
  assertEqual(quotedSticker.sticker.type, "sticker", "Preserva tipo da figurinha respondida");

  const quotedAudio = _private.getQuotedAudio({
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: ".vozgrave",
        contextInfo: {
          stanzaId: "audio-1",
          quotedMessage: audioMessage,
        },
      },
    },
  });

  assert(quotedAudio, "Detecta áudio respondido");
  assertEqual(quotedAudio.audio.type, "audio", "Preserva tipo do áudio respondido");

  const target = _private.getTargetJidFromMessage({
    message: {
      extendedTextMessage: {
        text: ".figpp @Ana",
        contextInfo: {
          mentionedJid: ["551188887777:12@s.whatsapp.net"],
        },
      },
    },
  });
  assertEqual(target.jid, "551188887777:12@s.whatsapp.net", "Detecta usuário marcado no .figpp");
  assertEqual(_private.getPhoneFromJid(target.jid), "551188887777", "Extrai número do JID marcado");
  assert(_private.getProfilePictureCandidates(target).includes("551188887777@s.whatsapp.net"), "Gera candidato normalizado para foto de perfil");
}

function testRankHelpers() {
  console.log("\n[10] Ranking");
  const rank = require("./lib/rank");
  const config = require("./config");
  rank.resetStatsForTests();

  const groupA = "120363-a@g.us";
  const groupB = "120363-b@g.us";
  const groupC = "120363-c@g.us";
  const ana = "551111111111@s.whatsapp.net";
  const anaDevice = "551111111111:24@s.whatsapp.net";
  const bia = "552222222222@s.whatsapp.net";
  const temaUser = "553333333333@s.whatsapp.net";
  const anaAlias = "559999999999999@s.whatsapp.net";

  assert(rank.isGroupJid(groupA), "Reconhece JID de grupo");
  assertEqual(rank.parseRankCommand(".rank").type, "group", ".rank mostra grupo");
  assertEqual(rank.parseRankCommand(".rank global").type, "global", ".rank global mostra global");
  assertEqual(rank.parseRankCommand(".rank global hoje").type, "invalid", ".rank global com texto extra é inválido");
  assertEqual(rank.parseRankCommand(".rank qualquer texto").type, "invalid", ".rank com texto extra é inválido");
  assertEqual(rank.parseRankCommand(".meurank").type, "me", ".meurank mostra posição");
  assertEqual(rank.parseRankCommand(".meurank teste").type, "invalid", ".meurank com texto extra é inválido");
  assertEqual(rank.parseRankCommand(".iniciarrank").type, "start", ".iniciarrank ativa grupo");
  assertEqual(rank.parseRankCommand(".iniciarrank teste").type, "invalid", ".iniciarrank com texto extra é inválido");
  assertEqual(rank.parseRankCommand(".zerarrank").type, "reset", ".zerarrank zera rank");
  assertEqual(rank.parseRankCommand(".zerarrank").scope, "group", ".zerarrank zera grupo atual");
  assertEqual(rank.parseRankCommand(".zerarrank global").scope, "global", ".zerarrank global zera todos");
  assertEqual(rank.parseRankCommand(".zerarrank grupo").type, "invalid", ".zerarrank com argumento inválido é inválido");
  assertEqual(rank.parseRankCommand(".removerank Ana Maria").type, "remove", ".removerank remove usuário");
  assertEqual(rank.parseRankCommand(".removerank Ana Maria").query, "Ana Maria", ".removerank preserva nome");
  assertEqual(rank.parseShopCommand(".loja").type, "shop", ".loja abre loja");
  assertEqual(rank.parseShopCommand(".comprar dragao").type, "buy", ".comprar compra tag");
  assertEqual(rank.parseShopCommand(".usartag dragao").type, "equip", ".usartag equipa tag");
  assertEqual(rank.parseShopCommand(".minhastags").type, "owned", ".minhastags lista tags");
  assertEqual(rank.parseShopCommand(".removertag").type, "unequip", ".removertag remove tag");
  assertEqual(rank.normalizeParticipantId(anaDevice), ana, "Normaliza participante pelo número");
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
  rank.addActivity({ groupId: groupA, participantId: ana, displayName: "Ana", points: 60000, now: 50000 });

  const groupRank = rank.rankGroup(groupA);
  assertEqual(groupRank[0].displayName, "Ana", "Rank do grupo é separado");
  assertEqual(groupRank[0].points, 60001, "Rank ordena por pontos");

  const globalRank = rank.rankGlobal();
  assertEqual(globalRank[0].displayName, "Ana", "Rank global soma grupos");
  assertEqual(globalRank[0].points, 60004, "Rank global soma pontos");

  assert(rank.formatShop(ana).includes("╭━━━❰ 🛒 LOJA DE TAGS 🛒 ❱━━━╮"), "Loja tem visual novo");
  assert(rank.formatShop(ana).includes("👑 Monarca do Caos"), "Loja lista tags");
  assert(!rank.formatShop(ana).includes("👽 DEV"), "Loja não mostra tag DEV");
  assert(rank.formatShop(ana).includes("daily +65%"), "Loja mostra bônus daily das tags");
  assert(!rank.formatShop(ana).includes("bloqueada • daily +200%"), "Loja não mostra bônus da tag oculta");
  assert(rank.formatShop(ana).includes("45000 pts"), "Loja mostra preços novos");
  assertEqual(rank.formatDailyBonus(config.shop.tags.find((tag) => tag.id === "diamante")), "+65%", "Formata bônus daily");
  assertEqual(rank.getRarityIcon("Lendária"), "🌟", "Loja usa ícone de raridade");
  assertEqual(rank.getTagByQuery("dragao").name, "🐉 Dragão do Zap", "Busca tag por id");
  assertEqual(rank.buyTag(ana, "dev").reason, "locked", "Tag DEV bloqueia usuário comum");
  assertEqual(rank.equipTag(ana, "dev").reason, "locked", "Tag DEV bloqueia equipar comum");
  assertEqual(rank.buyTag(ana, "dev", { allowLocked: true }).ok, true, "Dono compra tag DEV");
  assertEqual(rank.equipTag(ana, "dev", { allowLocked: true }).ok, true, "Dono equipa tag DEV");
  assert(rank.formatRankList(rank.rankGroup(groupA), "Rank").includes("[ 👽 DEV ] Ana"), "Rank mostra tag DEV");
  assert(rank.formatRankList(rank.rankGroup(groupA), "🏆 *Ranking do grupo*").includes("╭━━━❰ 🏆 RANKING DO GRUPO ❱━━━╮"), "Rank normal tem visual novo");
  rank.unequipTag(ana);
  assertEqual(rank.getUserWallet(ana).balance, 60004, "Saldo começa com pontos globais");
  rank.buyTag(anaAlias, "dev", { allowLocked: true });
  assertEqual(rank.resolveParticipantId(anaAlias, "Ana"), ana, "Resolve ID alternativo pelo nome do rank");
  assertEqual(rank.getOwnedTags(ana).some((tag) => tag.id === "dev"), true, "Migra tags do ID alternativo para o ID do rank");
  assertEqual(rank.buyTag(ana, "diamante").ok, true, "Compra tag com pontos");
  assertEqual(rank.buyTag(ana, "diamante").reason, "already_owned", "Não compra tag repetida");
  assertEqual(rank.getUserWallet(ana).balance, 30004, "Compra desconta saldo disponível");
  assertEqual(rank.rankGlobal()[0].points, 30004, "Compra desconta pontos do rank global");
  assertEqual(rank.rankGroup(groupA).find((item) => item.participantId === ana).points, 30001, "Compra desconta pontos do rank do grupo");
  assertEqual(rank.getLevelInfo(0).level, 1, "Level começa em 1");
  assertEqual(rank.getLevelInfo(100).level, 2, "Level sobe com XP");
  assert(rank.formatLevelCard({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("⭐ LEVEL"), "Formata level");
  assert(rank.formatTopLevel(rank.rankLevelGroup(groupA)).includes("TOP LEVEL"), "Formata top level");
  assertEqual(rank.equipTag(ana, "diamante").ok, true, "Equipa tag comprada");
  assertEqual(rank.equipTag(bia, "diamante").reason, "not_owned", "Não equipa tag sem comprar");
  assertEqual(rank.getEquippedTag(ana).name, "💎 Aura Diamante", "Lê tag equipada");
  assertEqual(rank.getDailyReward(ana).points, 33, "Daily usa bônus da tag equipada");
  const daily = rank.claimDaily({ groupId: groupA, participantId: ana, displayName: "Ana", now: 90000 });
  assertEqual(daily.ok, true, "Daily resgata pontos");
  assertEqual(daily.points, 33, "Daily com tag épica dá bônus");
  assertEqual(rank.claimDaily({ groupId: groupA, participantId: ana, displayName: "Ana", now: 91000 }).reason, "cooldown", "Daily tem cooldown");
  assertEqual(rank.getUserWallet(ana).balance, 30037, "Daily soma nos pontos do rank");
  assertEqual(rank.getRoulettePrize(() => 0).points, 0, "Roleta sorteia primeiro prêmio");
  assertEqual(rank.getRoulettePrize(() => 0.999).points, 100, "Roleta sorteia último prêmio");
  const roulette = rank.claimRoulette({ groupId: groupA, participantId: ana, displayName: "Ana", now: 100000, random: () => 0.999 });
  assertEqual(roulette.ok, true, "Roleta diária resgata pontos");
  assertEqual(roulette.points, 100, "Roleta aplica prêmio sorteado");
  assertEqual(rank.claimRoulette({ groupId: groupA, participantId: ana, displayName: "Ana", now: 101000, random: () => 0.999 }).reason, "cooldown", "Roleta tem cooldown próprio");
  assertEqual(rank.getUserWallet(ana).balance, 30137, "Roleta soma nos pontos do rank");
  const rouletteDev = rank.claimRoulette({ groupId: groupA, participantId: ana, displayName: "Ana", now: 102000, random: () => 0.999, ignoreCooldown: true });
  assertEqual(rouletteDev.ok, true, "Roleta dev ignora cooldown");
  assertEqual(rank.getUserWallet(ana).balance, 30237, "Roleta dev soma pontos sem cooldown");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("👤 PERFIL"), "Formata perfil");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("Tag: 💎 Aura Diamante"), "Perfil mostra tag equipada");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("Level:"), "Perfil mostra level");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("Conquistas:"), "Perfil mostra conquistas");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("Daily: 33 pts"), "Perfil mostra daily");
  const profileLevelUser = "554499999999@s.whatsapp.net";
  rank.addRankPoints({ groupId: groupB, participantId: profileLevelUser, displayName: "Perfil", points: 1, now: 91500 });
  rank.addRankPoints({ groupId: groupA, participantId: profileLevelUser, displayName: "Perfil", points: 3, now: 91600 });
  assert(rank.formatLevelCard({ groupId: groupA, participantId: profileLevelUser, displayName: "Perfil" }).includes("Total XP: 3"), ".level usa XP do grupo atual");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: profileLevelUser, displayName: "Perfil" }).includes("Level: 1 (3 XP)"), ".perfil usa o mesmo XP do .level");
  assertEqual(rank.getLevelStatsForContext(groupA, profileLevelUser).points, 3, "Helper de level pega grupo atual");
  assert(rank.formatProfileThemeShop(ana).includes("🎨 TEMAS DO PERFIL"), "Loja de temas tem visual");
  assert(rank.formatProfileThemeShop(ana).includes("🔒 👽 DEV"), "Loja mostra tema exclusivo bloqueado");
  assertEqual(rank.buyProfileTheme(temaUser, "t00m").reason, "locked", "Tema exclusivo bloqueia usuário comum");
  rank.addRankPoints({ groupId: groupB, participantId: temaUser, displayName: "Tema", points: 6000, now: 92000 });
  assertEqual(rank.grantTag(temaUser, "dev", { allowLocked: true, equip: true }).ok, true, "Dev dá tag bloqueada");
  assertEqual(rank.getEquippedTag(temaUser).id, "dev", "Dev equipa tag em usuário");
  assertEqual(rank.revokeTag(temaUser, "dev").ok, true, "Dev remove tag de usuário");
  assertEqual(rank.getEquippedTag(temaUser), null, "Tag removida desequipa usuário");
  assertEqual(rank.grantProfileTheme(temaUser, "t00m", { allowLocked: true, equip: true }).ok, true, "Dev dá tema bloqueado");
  assertEqual(rank.getEquippedProfileTheme(temaUser).id, "t00m", "Dev equipa tema em usuário");
  assertEqual(rank.revokeProfileTheme(temaUser, "t00m").ok, true, "Dev remove tema de usuário");
  assertEqual(rank.getEquippedProfileTheme(temaUser), null, "Tema removido desequipa usuário");
  rank.addActivity({ groupId: groupA, participantId: temaUser, displayName: "Tema", points: 1, activityType: "sticker", now: Date.parse("2026-07-14T05:30:00-03:00") });
  assert(rank.formatAchievements({ groupId: groupA, participantId: temaUser, displayName: "Tema" }).includes("✅ 🌅 Madrugador"), "Conquista madrugador desbloqueia");
  assert(rank.formatAchievements({ groupId: groupA, participantId: temaUser, displayName: "Tema" }).includes("🏅 CONQUISTAS"), "Formata conquistas");
  assertEqual(rank.buyProfileTheme(temaUser, "neon").ok, true, "Compra tema do perfil");
  assertEqual(rank.equipProfileTheme(temaUser, "neon").ok, true, "Equipa tema do perfil");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: temaUser, displayName: "Tema" }).includes("PERFIL NEON"), "Perfil usa tema equipado");
  assertEqual(rank.buyProfileTheme(ana, "t00m", { allowLocked: true }).ok, true, "Dono compra tema exclusivo");
  assertEqual(rank.equipProfileTheme(ana, "t00m", { allowLocked: true }).ok, true, "Dono equipa tema exclusivo");
  assert(rank.formatUserProfile({ groupId: groupA, participantId: ana, displayName: "Ana" }).includes("DEV PERFIL"), "Perfil usa tema exclusivo");
  assert(rank.formatRankList(rank.rankGroup(groupA), "Rank").includes("[ 💎 Aura Diamante ] Ana"), "Rank mostra tag equipada");
  assert(rank.formatRankList(rank.rankGlobal(), "🌎 *Ranking global*").includes("╭━━━❰ 🌎 RANKING GLOBAL ❱━━━╮"), "Rank global tem visual novo");
  assert(rank.formatOwnedTags(ana).includes("✅ { 💎 Aura Diamante }"), "Minhas tags mostra equipada");
  rank.unequipTag(ana);
  assertEqual(rank.getEquippedTag(ana), null, "Remove tag equipada");

  rank.addActivity({ groupId: groupB, participantId: anaDevice, displayName: "Ana", points: 1, now: 45000 });
  assertEqual(rank.getRankUserId(anaDevice), rank.getRankUserId(ana), "Mesmo número mantém mesmo ID");
  assertEqual(rank.rankGlobal().filter((item) => item.displayName === "Ana").length, 1, "Mesmo número não duplica no global");

  const position = rank.getUserPosition(groupA, ana);
  assertEqual(position.position, 1, "Mostra posição do usuário");
  assert(rank.formatRankList(groupRank, "🏆 *Ranking do grupo*").includes("Bia"), "Formata ranking");
  assert(rank.formatRankList(groupRank, "🏆 *Ranking do grupo*").includes("id 02"), "Ranking mostra ID público curto");
  assert(rank.formatRankList([], "🏆 *Ranking do grupo*").includes("Ainda não tenho pontos por aqui."), "Rank vazio tem visual novo");
  assertEqual(rank.getRankUserId(ana), "01", "Primeiro ID público é 01");
  assertEqual(rank.getRankUserId(bia), "02", "Segundo ID público é 02");
  assert(rank.formatMyRank(position, "Ana").includes("Posição: #1"), "Formata meu rank");
  rank.startRank(groupC, 10000);
  const levelUser = "554444444444@s.whatsapp.net";
  const noLevelUp = rank.addActivity({ groupId: groupC, participantId: levelUser, displayName: "Level", points: 99, now: 50100 });
  const levelUp = rank.addActivity({ groupId: groupC, participantId: levelUser, displayName: "Level", points: 1, now: 60100 });
  assertEqual(noLevelUp.levelUp, null, "Não avisa level sem subir");
  assertEqual(levelUp.levelUp.level, 2, "Detecta level up");
  rank.addRankPoints({ groupId: groupC, participantId: levelUser, displayName: "Level", points: 50, now: 61100 });
  assertEqual(rank.getUserWallet(levelUser).balance, 150, "Dev adiciona XP");
  rank.addLevelXp({ groupId: groupC, participantId: levelUser, displayName: "Level", xp: 50, now: 62100 });
  assertEqual(rank.getUserLevelXp(rank.getLevelStatsForContext(groupC, levelUser)), 200, "Dev adiciona XP separado");
  assertEqual(rank.removeLevelXp({ groupId: groupC, participantId: levelUser, xp: 25 }).ok, true, "Dev remove XP separado");
  assertEqual(rank.getUserWallet(levelUser).balance, 150, "XP removido não altera pontos do rank");
  rank.setLevelXp({ groupId: groupC, participantId: levelUser, displayName: "Level", xp: 500, now: 63100 });
  assertEqual(rank.getUserLevelXp(rank.getLevelStatsForContext(groupC, levelUser)), 500, "Dev seta XP no grupo");
  rank.setLevelXp({ groupId: groupC, participantId: levelUser, displayName: "Level", xp: 0, now: 64100 });
  assertEqual(rank.getUserLevelXp(rank.getLevelStatsForContext(groupC, levelUser)), 0, "Dev reseta XP no grupo");
  rank.setRankPoints({ groupId: groupC, participantId: levelUser, displayName: "Level", points: 300, now: 64100 });
  rank.addRankPoints({ groupId: groupC, participantId: "555555555555@s.whatsapp.net", displayName: "Outro", points: 200, now: 65100 });
  assertEqual(rank.resetGroupLevel(groupC), true, "Dev reseta level do grupo inteiro");
  assert(rank.rankGroup(groupC).some((item) => item.points > 0), "Reset level do grupo preserva pontos do rank");
  assert(rank.rankLevelGroup(groupC).every((item) => item.levelInfo.totalXp === 0), "Reset level do grupo zera só XP");
  assert(rank.isRankEnabled(groupC), "Reset level do grupo mantém rank ativo");
  rank.resetGroupRank(groupC);
  rank.setRankEnabled(groupC, false);
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
  rank.removeUserGlobally("Tema");

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
  console.log("\n[10] Cache de última mídia");
  const { _private } = require("./lib/bot");
  const msg = { key: { id: "media-1" }, message: { imageMessage: {} } };
  const media = _private.getMedia(msg.message);

  _private.rememberMedia("chat-cache", msg, media, 1000);

  const recent = _private.getRecentMedia("chat-cache", 2000);
  assert(recent, "Recupera mídia recente");
  assertEqual(recent.msg.key.id, "media-1", "Mídia recuperada é a correta");

  const expired = _private.getRecentMedia("chat-cache", 1000 + 6 * 60 * 1000);
  assert(!expired, "Expira mídia antiga");

  const audioMsg = { key: { id: "audio-1" }, message: { audioMessage: { ptt: false } } };
  const audio = _private.getAudio(audioMsg.message);
  _private.rememberAudio("chat-cache", audioMsg, audio, 1000);
  assertEqual(_private.getRecentAudio("chat-cache", 2000).msg.key.id, "audio-1", "Recupera áudio recente");
  assert(!_private.getRecentAudio("chat-cache", 1000 + 6 * 60 * 1000), "Expira áudio antigo");
}

function testConverterHelpers() {
  console.log("\n[11] Tentativas de vídeo");
  const { _private } = require("./lib/stickerConverter");
  const attempts = _private.buildVideoAttempts();

  assert(attempts.length > 0, "Gera tentativas de compressão");
  assert(attempts.some((item) => item.duration < 6), "Inclui cortes menores");
  assert(attempts.some((item) => item.size < 512), "Inclui reduções de tamanho");
  assert(attempts.every((item) => item.size === item.size), "Mantém saída quadrada");

  const source = _private.buildVideoFilter({ fps: 15, size: 512 });
  assert(source.includes("scale=512:512"), "Vídeo achata para 512x512");
  assert(!source.includes("crop="), "Vídeo não recorta");
  const cropped = _private.buildVideoFilter({ fps: 15, size: 512, crop: true });
  assert(cropped.includes("crop='min(iw,ih)':'min(iw,ih)'"), ".figcrop recorta vídeo/GIF");
  assert(cropped.endsWith("scale=512:512"), ".figcrop redimensiona vídeo após recortar");

  const exif = _private.createStickerExif();
  assert(exif.includes(Buffer.from("[ DONO ] : ╳ T00M4ZIOW BOT ╳\\n[ INSTA ]: @tomaziow")), "EXIF contém assinatura em duas linhas");

  const tinyWebp = Buffer.concat([
    Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "binary"),
    Buffer.from([10, 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x02, 0x00, 0x02]),
  ]);
  tinyWebp.writeUInt32LE(tinyWebp.length - 8, 4);
  const withExif = _private.insertWebpChunk(tinyWebp, "EXIF", exif);
  assertEqual(withExif.toString("ascii", 12, 16), "VP8X", "Insere VP8X antes de EXIF");
  assert((withExif[20] & 0x08) === 0x08, "VP8X declara EXIF");
  assert(_private.getRgbTextColor(1, 2).startsWith("hsl("), "Gera cor RGB por frame");
}

async function testServer() {
  console.log("\n[14] Servidor QR");
  const { startServer } = require("./lib/server");
  const server = await startServer(0, () => ({ currentQR: null, status: "waiting" }));

  assert(server && typeof server.close === "function", "Servidor inicia e retorna instância");
  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  console.log("=== Testes do Sticker Bot ===");

  await testImageConversion();
  await testVideoConversion();
  await testTextStickerConversion();
  await testAudioConversion();
  testConfig();
  await testBotHelpers();
  await testRankCommandOutsideGroup();
  testMediaParsing();
  testRankHelpers();
  testRecentMediaCache();
  testConverterHelpers();
  testXboxDealsHelpers();
  await testNvidiaAiHelpers();
  await testServer();

  console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam, ${skipped} pulados ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});

