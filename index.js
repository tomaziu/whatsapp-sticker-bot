/**
 * index.js — Bot de WhatsApp que converte imagens/GIFs em figurinhas
 *
 * Como usar:
 *   1. npm start
 *   2. Abra http://localhost:3000 no navegador
 *   3. No celular: WhatsApp > Dispositivos conectados > Vincular dispositivo
 *   4. Escaneie o QR Code que aparece no navegador
 *   5. Pronto! Envie imagem/gif com ".fig" ou ".sticker" como legenda
 */
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");
const http = require("http");
const fs = require("fs");
const config = require("./config");
const { imageToSticker, videoToSticker } = require("./lib/stickerConverter");

const logger = pino({ level: "warn" });

let currentQR = null;
let status = "waiting";
let serverStarted = false;

function checkFfmpeg() {
  const { execSync } = require("child_process");
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    execSync("ffprobe -version", { stdio: "ignore" });
    console.log("[OK] ffmpeg detectado.");
  } catch {
    console.error("[ERRO] Instale o ffmpeg: winget install FFmpeg");
    process.exit(1);
  }
}

function startServer(port) {
  if (serverStarted) return;
  serverStarted = true;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sticker Bot</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:system-ui;color:#fff}
.c{text-align:center;padding:30px}
h1{color:#25d366;margin-bottom:6px}
.s{color:#aaa;margin-bottom:24px;font-size:14px}
.s.ok{color:#25d366;font-weight:bold}
.q{background:#fff;border-radius:14px;padding:16px;display:inline-block;min-width:300px;min-height:300px}
.q img{display:block;width:280px;height:280px}
.h{margin-top:16px;color:#555;font-size:13px}
@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
.ld{animation:p 1.2s infinite;color:#333;padding:120px 0;font-size:16px}
</style></head>
<body>
<div class="c">
  <h1>WhatsApp Sticker Bot</h1>
  <p class="s" id="st">Escaneie o QR Code com o WhatsApp</p>
  <div class="q" id="qb"><p class="ld">Carregando...</p></div>
  <p class="h" id="ht">WhatsApp &gt; Dispositivos conectados &gt; Vincular dispositivo</p>
</div>
<script>
async function load(){
  try{
    const r=await fetch("/qr");
    const d=await r.json();
    if(d.status==="connected"){
      document.getElementById("st").textContent="Conectado! Pode fechar.";
      document.getElementById("st").className="s ok";
      document.getElementById("qb").innerHTML='<p style="color:#25d366;font-size:64px">&#10003;</p>';
      document.getElementById("ht").textContent="";
      return;
    }
    if(d.qr){
      document.getElementById("qb").innerHTML='<img src="data:image/png;base64,'+d.qr+'">';
    }
  }catch(e){}
}
load();setInterval(load,2000);
</script></body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/qr") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ qr: currentQR, status }));
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    }
  });

  server.listen(port, () => {
    console.log(`\n>>> Abra http://localhost:${port} no navegador <<<\n`);
  });
}

function hasStickerCommand(msg) {
  const caption =
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";
  const t = caption.trim().toLowerCase();
  return t === config.commandPrefix || t === config.commandPrefixAlt;
}

async function processMessage(sock, messageUpdate) {
  const msg = messageUpdate.messages?.[0];
  if (!msg) return;

  const from = msg.key.remoteJid;
  const m = msg.message;
  if (!m) return;

  const isImage = !!m.imageMessage;
  const isVideo = !!m.videoMessage;

  if (!hasStickerCommand(msg)) return;

  if (!isImage && !isVideo) {
    await sock.sendMessage(from, {
      text: 'Envie imagem ou GIF/vídeo com ".fig" na legenda.',
    });
    return;
  }

  console.log(`[+] ${isImage ? "Imagem" : "Video"} de ${from}`);

  try {
    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

    const buf = await downloadMediaMessage(msg, "buffer", {});
    const sticker = isImage
      ? await imageToSticker(buf)
      : await videoToSticker(buf);

    await sock.sendMessage(from, {
      sticker,
      mimetype: "image/webp",
      packname: "bot do t00m4ziow",
      author: "bot do t00m4ziow",
    });

    console.log(`[OK] Figurinha enviada para ${from}`);
  } catch (err) {
    console.error(`[ERRO] ${err.message}`);
    await sock.sendMessage(from, {
      text: `Erro ao converter: ${err.message}`,
    });
  }
}

async function startBot() {
  checkFfmpeg();

  if (!fs.existsSync(config.paths.authInfo)) {
    fs.mkdirSync(config.paths.authInfo, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.paths.authInfo);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[Info] WhatsApp Web v${version.join(".")}`);

  startServer(config.qrServerPort || 3000);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ["Sticker Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (u) => {
    if (u.type !== "notify") return;
    for (const m of u.messages) await processMessage(sock, { messages: [m] });
  });

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      currentQR = dataUrl.split(",")[1];
      status = "waiting";
      console.log("[QR] Pronto! Escaneie no navegador.");
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("[!] Reconectando...");
        currentQR = null;
        startBot();
      } else {
        console.log("[!] Deslogado. Apague a pasta session/ e reinicie.");
        currentQR = null;
        status = "error";
      }
    }

    if (connection === "open") {
      currentQR = null;
      status = "connected";
      console.log("[OK] Bot conectado ao WhatsApp!");
    }
  });
}

startBot().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
