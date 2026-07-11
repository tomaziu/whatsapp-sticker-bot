const { clearSession, getSessionPath } = require("../lib/session");

clearSession();
console.log(`Sessão apagada em: ${getSessionPath()}`);
console.log("Reinicie o bot para gerar um QR Code novo.");
