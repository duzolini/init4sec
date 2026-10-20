// Configuração efetiva: variáveis de ambiente > valores salvos pela UI > padrões.
import fs from "node:fs";
import path from "node:path";
import { get, save } from "./store.js";

// Carrega .env simples (KEY=VALUE) sem dependências externas
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2] !== "") process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const DEFAULTS = {
  X_BEARER_TOKEN: "",
  X_QUERY_MAX_LEN: "512",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_MODEL: "claude-opus-5-5",
};

const SECRET_KEYS = new Set(["X_BEARER_TOKEN", "ANTHROPIC_API_KEY"]);

export function cfg(key) {
  if (process.env[key]) return process.env[key];
  const saved = get().settings[key];
  if (saved) return saved;
  return DEFAULTS[key] ?? "";
}

export function setSettings(patch) {
  const s = get().settings;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in patch)) continue;
    const v = String(patch[key] ?? "").trim();
    if (v === "") delete s[key];
    else s[key] = v;
  }
  save();
}

// Visão segura para a UI: segredos mascarados e origem de cada valor
export function publicSettings() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = cfg(key);
    const origin = process.env[key] ? "env" : get().settings[key] ? "ui" : "default";
    out[key] = {
      origin,
      set: Boolean(value),
      value: SECRET_KEYS.has(key) ? (value ? "••••" + value.slice(-4) : "") : value,
    };
  }
  return out;
}
