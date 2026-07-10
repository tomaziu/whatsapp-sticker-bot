/**
 * config.js — Configurações centralizadas do bot
 * Altere os valores abaixo para personalizar comportamento e limites.
 */
module.exports = {
  // Prefixo que ativa a conversão (envie imagem/gif/vídeo com essa legenda)
  commandPrefix: ".fig",
  commandPrefixAlt: ".sticker",

  // Limites para figurinhas (WhatsApp)
  sticker: {
    maxSizeKB: 500,        // Tamanho máximo em KB
    maxWidth: 512,         // Largura máxima em pixels
    maxHeight: 512,        // Altura máxima em pixels
    maxDurationSec: 6,     // Duração máxima de vídeos/GIFs em segundos
    defaultFps: 15,        // FPS padrão para GIFs/vídeos animados
    defaultBitrate: "200k", // Bitrate padrão para compressão de vídeo
  },

  // Porta do servidor web que mostra o QR Code no navegador
  qrServerPort: 3000,

  // Caminhos de pastas
  paths: {
    authInfo: "./session", // Onde salvar dados de autenticação do WhatsApp
  },
};
