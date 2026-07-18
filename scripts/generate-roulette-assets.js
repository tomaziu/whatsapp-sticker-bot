const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "assets", "roulette");
const size = 512;
const center = size / 2;
const radius = 214;
const innerRadius = 74;
const fps = 12;
const spinFrames = 42;
const revealFrames = 22;
const frames = spinFrames + revealFrames;

const prizes = [
  { id: "0", label: "0 pts", value: 0, color: "#222833", text: "#f5f7ff" },
  { id: "5", label: "+5", value: 5, color: "#3f8cff", text: "#ffffff" },
  { id: "10", label: "+10", value: 10, color: "#23c483", text: "#07130d" },
  { id: "20", label: "+20", value: 20, color: "#ffe66d", text: "#171400" },
  { id: "35", label: "+35", value: 35, color: "#ff8a3d", text: "#1b0900" },
  { id: "50", label: "+50", value: 50, color: "#ff4d7d", text: "#ffffff" },
  { id: "100", label: "+100", value: 100, color: "#a855f7", text: "#ffffff" },
];

function polar(angleDeg, currentRadius = radius) {
  const angle = angleDeg * Math.PI / 180;
  return {
    x: center + Math.sin(angle) * currentRadius,
    y: center - Math.cos(angle) * currentRadius,
  };
}

function sectorPath(startAngle, endAngle) {
  const outerStart = polar(startAngle, radius);
  const outerEnd = polar(endAngle, radius);
  const innerEnd = polar(endAngle, innerRadius);
  const innerStart = polar(startAngle, innerRadius);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function wheelSvg(targetPrize, frameIndex) {
  const sector = 360 / prizes.length;
  const targetIndex = prizes.findIndex((item) => item.id === targetPrize.id);
  const targetCenter = targetIndex * sector + sector / 2;
  const finalRotation = 360 * 5 - targetCenter;
  const spinIndex = Math.min(frameIndex, spinFrames - 1);
  const isReveal = frameIndex >= spinFrames;
  const progress = easeOutCubic(spinIndex / (spinFrames - 1));
  const wobble = spinIndex > spinFrames - 12 && !isReveal
    ? Math.sin((spinIndex - (spinFrames - 12)) / 11 * Math.PI * 3) * (1 - (spinIndex - (spinFrames - 12)) / 11) * 5
    : 0;
  const rotation = finalRotation * progress + wobble;
  const scale = spinIndex > spinFrames - 10 && !isReveal
    ? 1 + Math.sin((spinIndex - (spinFrames - 10)) / 9 * Math.PI) * 0.025
    : 1;
  const resultText = isReveal ? `PREMIO: ${targetPrize.value} PTS` : "GIRANDO...";
  const resultColor = isReveal ? targetPrize.color : "#20f59a";
  const revealPulse = isReveal
    ? 1 + Math.sin((frameIndex - spinFrames) / Math.max(1, revealFrames - 1) * Math.PI) * 0.035
    : 1;

  const slices = prizes.map((prize, index) => {
    const start = index * sector;
    const end = start + sector;
    const mid = start + sector / 2;
    const textPoint = polar(mid, 146);
    const isTarget = prize.id === targetPrize.id;
    return `
      <path d="${sectorPath(start, end)}" fill="${prize.color}" stroke="#05070d" stroke-width="${isTarget ? 5 : 3}"/>
      <text x="${textPoint.x.toFixed(2)}" y="${textPoint.y.toFixed(2)}"
        transform="rotate(${mid} ${textPoint.x.toFixed(2)} ${textPoint.y.toFixed(2)})"
        fill="${prize.text}" font-family="Arial, Helvetica, sans-serif"
        font-size="${isTarget ? 30 : 27}" font-weight="900"
        text-anchor="middle" dominant-baseline="middle">${prize.label}</text>
    `;
  }).join("");

  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="42%" r="70%">
        <stop offset="0%" stop-color="#1b2a44"/>
        <stop offset="62%" stop-color="#090d18"/>
        <stop offset="100%" stop-color="#02040a"/>
      </radialGradient>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.3 0 0 0 0 1 0 0 0 0 0.55 0 0 0 0.8 0"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="gold" x1="0%" x2="100%">
        <stop offset="0%" stop-color="#fff5a8"/>
        <stop offset="50%" stop-color="#ffc247"/>
        <stop offset="100%" stop-color="#ff8f1f"/>
      </linearGradient>
    </defs>

    <rect width="512" height="512" fill="url(#bg)"/>
    <circle cx="${center}" cy="${center}" r="238" fill="none" stroke="#20f59a" stroke-width="4" opacity="0.42"/>
    <circle cx="${center}" cy="${center}" r="226" fill="#08101d" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>

    <g transform="translate(${center} ${center}) scale(${scale.toFixed(4)}) translate(${-center} ${-center}) rotate(${rotation.toFixed(3)} ${center} ${center})" filter="url(#glow)">
      ${slices}
      <circle cx="${center}" cy="${center}" r="${innerRadius - 7}" fill="#07101b" stroke="#ffffff" stroke-opacity="0.3" stroke-width="3"/>
      <text x="${center}" y="${center - 7}" fill="#20f59a" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" text-anchor="middle">ROLETA</text>
      <text x="${center}" y="${center + 24}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" text-anchor="middle">DIARIA</text>
    </g>

    <path d="M ${center - 29} 25 L ${center + 29} 25 L ${center} 84 Z" fill="url(#gold)" stroke="#fff7c2" stroke-width="4"/>
    <circle cx="${center}" cy="38" r="10" fill="#fff7c2"/>

    ${isReveal ? `<text x="${center}" y="416" fill="#fff7c2" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="900" text-anchor="middle">RESULTADO!</text>` : ""}
    <g transform="translate(${center} 456.5) scale(${revealPulse.toFixed(4)}) translate(${-center} -456.5)">
      <rect x="106" y="432" width="300" height="49" rx="17" fill="#050914" stroke="${resultColor}" stroke-width="3"/>
      <text x="${center}" y="465" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${isReveal ? 24 : 23}" font-weight="900" text-anchor="middle">
      ${resultText}
    </text>
    </g>
  </svg>`;
}

async function renderFrame(targetPrize, frameIndex, framePath) {
  await sharp(Buffer.from(wheelSvg(targetPrize, frameIndex)))
    .png()
    .toFile(framePath);
}

function runFfmpeg(args) {
  execFileSync("ffmpeg", args, { stdio: "ignore" });
}

async function generatePrize(targetPrize) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `roulette-${targetPrize.id}-`));
  try {
    for (let index = 0; index < frames; index += 1) {
      const framePath = path.join(tempDir, `frame-${String(index).padStart(3, "0")}.png`);
      await renderFrame(targetPrize, index, framePath);
    }

    const gifPath = path.join(outputDir, `roleta-${targetPrize.id}.gif`);
    const palettePath = path.join(tempDir, "palette.png");
    const inputPattern = path.join(tempDir, "frame-%03d.png");

    runFfmpeg([
      "-y", "-framerate", String(fps), "-i", inputPattern,
      "-vf", "palettegen=stats_mode=diff", palettePath,
    ]);
    runFfmpeg([
      "-y", "-framerate", String(fps), "-i", inputPattern, "-i", palettePath,
      "-lavfi", "paletteuse=dither=bayer:bayer_scale=3",
      "-loop", "0", gifPath,
    ]);
    return { gifPath };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (const prize of prizes) {
    results.push(await generatePrize(prize));
  }

  console.log("Roletas geradas:");
  for (const result of results) {
    const gifSize = fs.statSync(result.gifPath).size;
    console.log(`- ${path.relative(rootDir, result.gifPath)} (${Math.round(gifSize / 1024)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
