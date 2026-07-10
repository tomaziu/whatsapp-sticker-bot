module.exports = {
  commands: {
    menu: ".menu",
    sticker: [".fig", ".sticker"],
  },

  bot: {
    name: "Sticker Bot",
    allowSelfMessages: true,
    browser: ["Sticker Bot", "Chrome", "1.0.0"],
  },

  sticker: {
    size: 512,
    maxSizeKB: 500,
    maxDurationSec: 6,
    minDurationSec: 2,
    fps: 15,
    packId: "sticker-bot-local",
    packname: "Figurinhas do bot",
    author: "bot do @tomm",
    emojis: ["🤖"],
  },

  qrServerPort: 3000,

  paths: {
    authInfo: "./session",
  },
};
