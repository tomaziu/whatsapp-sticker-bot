/**
 * lib/server.js — Servidor HTTP para exibir QR Code no navegador
 */
const http = require("http");

const HTML = `<!DOCTYPE html>
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
    if(d.status==="reconnecting"){
      document.getElementById("st").textContent="Reconectando ao WhatsApp...";
      document.getElementById("qb").innerHTML='<p class="ld">Reconectando...</p>';
      return;
    }
    if(d.status==="logged_out"){
      document.getElementById("st").textContent="Sessão expirada. Aguarde um novo QR.";
      document.getElementById("qb").innerHTML='<p class="ld">Gerando novo QR...</p>';
      return;
    }
    if(d.qr){
      document.getElementById("qb").innerHTML='<img src="data:image/png;base64,'+d.qr+'">';
      return;
    }
    document.getElementById("qb").innerHTML='<p class="ld">Aguardando QR...</p>';
  }catch(e){}
}
load();setInterval(load,2000);
</script></body></html>`;

let serverRunning = false;

function startServer(port, getState) {
  if (serverRunning) return Promise.resolve();
  serverRunning = true;

  const server = http.createServer((req, res) => {
    const { currentQR, status } = getState();
    if (req.url === "/qr") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ qr: currentQR, status }));
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getState()));
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
    }
  });

  server.on("close", () => { serverRunning = false; });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      serverRunning = false;
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Porta ${port} já está em uso. Feche o outro bot antes de iniciar este.`));
        return;
      }
      reject(err);
    });

    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`\n>>> Abra http://localhost:${actualPort} no navegador <<<\n`);
      resolve(server);
    });
  });
}

module.exports = { startServer };
