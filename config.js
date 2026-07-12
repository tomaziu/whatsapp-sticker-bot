module.exports = {
  commands: {
    menu: ".menu",
    sticker: [".fig", ".sticker"],
    rank: ".rank",
    startRank: ".iniciarrank",
    myRank: ".meurank",
    resetRank: ".zerarrank",
  },

  bot: {
    name: "Sticker Bot",
    allowSelfMessages: true,
    browser: ["Sticker Bot", "Chrome", "1.0.0"],
    reconnectMinMs: 5000,
    reconnectMaxMs: 60000,
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

  rank: {
    enabled: true,
    topLimit: 10,
    points: {
      text: 1,
      media: 2,
      sticker: 1,
    },
    antiSpamMs: 5000,
  },

  qrServerPort: 3000,

  paths: {
    authInfo: "./session",
    dataDir: "./data",
    rankStats: "./data/rank-stats.json",
  },
};
