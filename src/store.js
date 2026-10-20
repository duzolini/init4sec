// Persistência simples em JSON (data/db.json). Escrita atômica via arquivo temporário + rename.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_SOURCES } from "./sources.js";

const DATA_DIR = process.env.INIT4SEC_DATA_DIR || path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY = () => ({
  version: 1,
  sources: DEFAULT_SOURCES.map((s) => ({ id: uid(), enabled: true, ...s })),
  targets: [],
  hunts: [],
  monitors: [],
  alerts: [],
  settings: {},
});

let db = null;
let writeTimer = null;

export function uid() {
  return crypto.randomBytes(6).toString("hex");
}

export function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } else {
    db = EMPTY();
    flush();
  }
  return db;
}

export function flush() {
  if (!db) return;
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Agrupa escritas próximas para não reescrever o arquivo a cada alteração
export function save() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 150);
}

export function get() {
  return load();
}

// Mantém o histórico limitado para o arquivo não crescer indefinidamente
export function pruneHistory(maxHunts = 200, maxAlerts = 500) {
  const d = load();
  if (d.hunts.length > maxHunts) d.hunts = d.hunts.slice(-maxHunts);
  if (d.alerts.length > maxAlerts) d.alerts = d.alerts.slice(-maxAlerts);
}

process.on("exit", flush);
