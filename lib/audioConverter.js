const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const audioEffects = {
  deepVoice: {
    label: "voz grave",
    filters: ["asetrate=44100*0.80", "aresample=44100", "atempo=1.25"],
  },
  thinVoice: {
    label: "voz fina",
    filters: ["asetrate=44100*1.25", "aresample=44100", "atempo=0.80"],
  },
  fastAudio: {
    label: "áudio veloz",
    filters: ["atempo=1.35"],
  },
  slowAudio: {
    label: "áudio lento",
    filters: ["atempo=0.75"],
  },
};

async function convertAudio(input, effectName) {
  const effect = audioEffects[effectName];
  if (!effect) throw new Error(`Efeito de áudio inválido: ${effectName}`);

  const id = crypto.randomUUID();
  const inputPath = path.join(os.tmpdir(), `audio-effect-input-${id}`);
  const outputPath = path.join(os.tmpdir(), `audio-effect-output-${id}.ogg`);

  try {
    await fs.promises.writeFile(inputPath, input);
    await runAudioConversion(inputPath, outputPath, effect.filters);
    return fs.promises.readFile(outputPath);
  } finally {
    safeUnlink(inputPath);
    safeUnlink(outputPath);
  }
}

function runAudioConversion(inputPath, outputPath, filters) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioFilters(filters.join(","))
      .audioCodec("libopus")
      .audioBitrate("64k")
      .audioFrequency(48000)
      .outputOptions(["-application", "voip"])
      .format("ogg")
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

function getAudioEffectByCommand(command, commands) {
  const normalized = String(command || "").trim().toLowerCase();
  return Object.entries(commands || {}).find(([, value]) => value === normalized)?.[0] || null;
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

module.exports = {
  audioEffects,
  convertAudio,
  getAudioEffectByCommand,
  _private: {
    runAudioConversion,
    safeUnlink,
  },
};
