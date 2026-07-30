const fs = require("fs");
const path = require("path");
const config = require("../config");

const COMMAND_GROUPS = {
  downloads: {
    label: "Downloads",
    commands: [config.commands.tiktokDownload, config.commands.instagramDownload],
  },
  ia: {
    label: "IA",
    commands: [config.commands.ai],
  },
  audio: {
    label: "Áudio",
    commands: Object.values(config.commands.audioEffects || {}),
  },
  diversao: {
    label: "Diversão",
    commands: [config.commands.raffle, config.commands.roulette],
  },
  figpin: {
    label: "Pinterest",
    commands: [config.commands.pinterestSticker],
  },
  figtxt: {
    label: "Figurinha de texto",
    commands: [config.commands.textSticker],
  },
  xbox: {
    label: "Xbox promo",
    commands: [config.commands.xboxDeals],
  },
  daily: {
    label: "Daily",
    commands: [config.commands.daily],
  },
  roleta: {
    label: "Roleta",
    commands: [config.commands.roulette],
  },
  sorteio: {
    label: "Sorteio",
    commands: [config.commands.raffle],
  },
  loja: {
    label: "Loja",
    commands: [config.commands.shop, config.commands.buyTag, config.commands.useTag, config.commands.myTags, config.commands.removeTag],
  },
  social: {
    label: "Social",
    commands: [config.commands.gift, config.commands.marriage, config.commands.marry, config.commands.acceptMarriage, config.commands.declineMarriage, config.commands.cancelMarriage, config.commands.divorce, config.commands.couple],
  },
};

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getStatePath() {
  return path.resolve(process.cwd(), config.paths.commandState);
}

function createDefaultState() {
  return { disabled: {} };
}

function loadState() {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) return createDefaultState();

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      disabled: parsed && typeof parsed.disabled === "object" && parsed.disabled ? parsed.disabled : {},
    };
  } catch {
    return createDefaultState();
  }
}

function saveState(state) {
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseCommandControl(text = "") {
  const parts = normalize(text).split(/\s+/).filter(Boolean);
  if (parts[0] !== ".cmd") return null;
  const action = parts[1] || "";
  if (action === "status" && parts.length === 2) return { type: "status" };
  if ((action === "on" || action === "off") && parts.length === 3) {
    return { type: action, target: parts[2] };
  }
  return { type: "invalid" };
}

function resolveTarget(target = "") {
  const raw = normalize(target);
  if (raw.startsWith(".")) {
    const commandGroup = Object.entries(COMMAND_GROUPS).find(([, entry]) => {
      return entry.commands.map(normalize).includes(raw);
    });
    if (!commandGroup) return null;

    return {
      key: raw,
      label: raw,
      commands: [raw],
    };
  }

  const normalized = raw.replace(/^\./, "");
  if (!normalized) return null;

  if (COMMAND_GROUPS[normalized]) {
    return {
      key: normalized,
      label: COMMAND_GROUPS[normalized].label,
      commands: COMMAND_GROUPS[normalized].commands.map(normalize),
    };
  }

  const command = `.${normalized}`;
  const group = Object.entries(COMMAND_GROUPS).find(([, entry]) => {
    return entry.commands.map(normalize).includes(command);
  });
  if (!group) return null;

  return {
    key: command,
    label: command,
    commands: [command],
  };
}

function setDisabled(target, disabled) {
  const resolved = resolveTarget(target);
  if (!resolved) return { ok: false, reason: "not_found", target };

  const state = loadState();
  state.disabled[resolved.key] = {
    disabled: !!disabled,
    label: resolved.label,
    commands: resolved.commands,
    updatedAt: new Date().toISOString(),
  };
  if (!disabled) delete state.disabled[resolved.key];
  saveState(state);
  return { ok: true, disabled: !!disabled, target: resolved };
}

function getDisabledEntries() {
  const state = loadState();
  return Object.entries(state.disabled || {})
    .filter(([, entry]) => entry?.disabled)
    .map(([key, entry]) => ({ key, ...entry }));
}

function isCommandDisabled(text = "") {
  const first = normalize(text).split(/\s+/).filter(Boolean)[0];
  if (!first) return false;
  return getDisabledEntries().some((entry) => {
    const commands = Array.isArray(entry.commands) ? entry.commands : [];
    return commands.map(normalize).includes(first);
  });
}

function formatCommandControlStatus() {
  const entries = getDisabledEntries();
  const available = Object.entries(COMMAND_GROUPS)
    .map(([key, entry]) => `${key} (${entry.commands.join(", ")})`)
    .join("\n");

  return [
    "⚙️ *Controle de comandos*",
    "",
    entries.length
      ? `Desativados:\n${entries.map((entry) => `• ${entry.label}`).join("\n")}`
      : "Desativados: nenhum",
    "",
    "Alvos disponíveis:",
    available,
    "",
    "Uso:",
    ".cmd off downloads",
    ".cmd on downloads",
    ".cmd status",
  ].join("\n");
}

function resetCommandControlForTests() {
  try {
    fs.rmSync(getStatePath(), { force: true });
  } catch {}
}

module.exports = {
  COMMAND_GROUPS,
  formatCommandControlStatus,
  getDisabledEntries,
  isCommandDisabled,
  parseCommandControl,
  resetCommandControlForTests,
  resolveTarget,
  setDisabled,
  _private: {
    getStatePath,
    loadState,
    normalize,
    saveState,
  },
};
