// Servidor HTTP do init4sec: API REST + interface web estática.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, save, uid, flush } from "./store.js";
import { cfg, setSettings, publicSettings } from "./config.js";
import { SOURCE_CATEGORIES } from "./sources.js";
import { lookupUsers } from "./collectors/x.js";
import { runHunt, huntSummary } from "./hunt.js";
import { runMonitor, startScheduler } from "./scheduler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

// Chave de acesso opcional (recomendado se expuser fora de 127.0.0.1)
app.use("/api", (req, res, next) => {
  const key = process.env.INIT4SEC_ACCESS_KEY;
  if (!key || req.get("x-init4sec-key") === key) return next();
  res.status(401).json({ error: "Chave de acesso inválida" });
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(500).json({ error: err.message }));

const handleRe = /^[A-Za-z0-9_]{1,15}$/;
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);

// ---------- status ----------
app.get("/api/status", (req, res) => {
  const db = get();
  res.json({
    x_ready: Boolean(cfg("X_BEARER_TOKEN")),
    ai_ready: Boolean(cfg("ANTHROPIC_API_KEY")),
    model: cfg("ANTHROPIC_MODEL"),
    counts: {
      sources: db.sources.filter((s) => s.enabled).length,
      targets: db.targets.length,
      hunts: db.hunts.length,
      monitors: db.monitors.filter((m) => m.enabled).length,
      unread_alerts: db.alerts.filter((a) => !a.read).length,
    },
  });
});

// ---------- fontes ----------
app.get("/api/sources", (req, res) => res.json({ sources: get().sources, categories: SOURCE_CATEGORIES }));

app.post("/api/sources", (req, res) => {
  const handle = String(req.body.handle || "").replace(/^@/, "").trim();
  if (!handleRe.test(handle)) return res.status(400).json({ error: "Handle inválido" });
  const db = get();
  if (db.sources.some((s) => s.handle.toLowerCase() === handle.toLowerCase()))
    return res.status(409).json({ error: "Fonte já cadastrada" });
  const src = {
    id: uid(),
    handle,
    category: SOURCE_CATEGORIES.includes(req.body.category) ? req.body.category : "other",
    reliability: Math.min(5, Math.max(1, Number(req.body.reliability) || 3)),
    note: String(req.body.note || "").slice(0, 200),
    enabled: true,
  };
  db.sources.push(src);
  save();
  res.status(201).json(src);
});

app.patch("/api/sources/:id", (req, res) => {
  const src = get().sources.find((s) => s.id === req.params.id);
  if (!src) return res.status(404).json({ error: "Fonte não encontrada" });
  if ("enabled" in req.body) src.enabled = Boolean(req.body.enabled);
  if ("reliability" in req.body) src.reliability = Math.min(5, Math.max(1, Number(req.body.reliability) || 3));
  if ("category" in req.body && SOURCE_CATEGORIES.includes(req.body.category)) src.category = req.body.category;
  if ("note" in req.body) src.note = String(req.body.note).slice(0, 200);
  save();
  res.json(src);
});

app.delete("/api/sources/:id", (req, res) => {
  const db = get();
  db.sources = db.sources.filter((s) => s.id !== req.params.id);
  save();
  res.status(204).end();
});

app.post("/api/sources/validate", wrap(async (req, res) => {
  const db = get();
  const result = await lookupUsers(db.sources.map((s) => s.handle));
  for (const s of db.sources) s.validation = result[s.handle.toLowerCase()] || { ok: false, error: "Sem resposta" };
  save();
  res.json({ sources: db.sources });
}));

// ---------- alvos ----------
app.get("/api/targets", (req, res) => res.json(get().targets));

app.post("/api/targets", (req, res) => {
  const value = String(req.body.value || "").trim();
  if (!value || value.length > 100) return res.status(400).json({ error: "Alvo inválido" });
  const t = { id: uid(), value, kind: req.body.kind || "keyword", created_at: new Date().toISOString() };
  get().targets.push(t);
  save();
  res.status(201).json(t);
});

app.delete("/api/targets/:id", (req, res) => {
  const db = get();
  db.targets = db.targets.filter((t) => t.id !== req.params.id);
  save();
  res.status(204).end();
});

// ---------- caças ----------
app.get("/api/hunts", (req, res) => res.json(get().hunts.slice().reverse().map(huntSummary)));

app.get("/api/hunts/:id", (req, res) => {
  const h = get().hunts.find((x) => x.id === req.params.id);
  h ? res.json(h) : res.status(404).json({ error: "Caça não encontrada" });
});

app.post("/api/hunts", wrap(async (req, res) => {
  if (!cfg("X_BEARER_TOKEN")) return res.status(400).json({ error: "Configure o token da X API na aba Config." });
  const mode = ["sources", "global", "hybrid"].includes(req.body.mode) ? req.body.mode : "sources";
  const hunt = await runHunt({
    name: req.body.name,
    keywords: list(req.body.keywords),
    mode,
    hours: Number(req.body.hours) || 72,
    sourceIds: Array.isArray(req.body.sourceIds) && req.body.sourceIds.length ? req.body.sourceIds : null,
  });
  res.status(hunt.status === "error" ? 502 : 201).json(hunt);
}));

app.delete("/api/hunts/:id", (req, res) => {
  const db = get();
  db.hunts = db.hunts.filter((h) => h.id !== req.params.id);
  save();
  res.status(204).end();
});

// ---------- monitores ----------
app.get("/api/monitors", (req, res) =>
  res.json(get().monitors.map(({ seen_ids, ...m }) => m)));

app.post("/api/monitors", (req, res) => {
  const keywords = list(req.body.keywords);
  if (!keywords.length) return res.status(400).json({ error: "Informe ao menos um alvo" });
  const webhook = String(req.body.webhook || "").trim();
  if (webhook && !/^https:\/\//.test(webhook)) return res.status(400).json({ error: "Webhook deve ser https://" });
  const m = {
    id: uid(),
    name: String(req.body.name || keywords.join(", ")).slice(0, 80),
    keywords,
    mode: ["sources", "global", "hybrid"].includes(req.body.mode) ? req.body.mode : "sources",
    interval_minutes: Math.max(15, Number(req.body.interval_minutes) || 60),
    webhook,
    enabled: true,
    created_at: new Date().toISOString(),
  };
  get().monitors.push(m);
  save();
  res.status(201).json(m);
});

app.patch("/api/monitors/:id", (req, res) => {
  const m = get().monitors.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Monitor não encontrado" });
  if ("enabled" in req.body) m.enabled = Boolean(req.body.enabled);
  save();
  res.json(m);
});

app.post("/api/monitors/:id/run", wrap(async (req, res) => {
  const m = get().monitors.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Monitor não encontrado" });
  if (!cfg("X_BEARER_TOKEN")) return res.status(400).json({ error: "Configure o token da X API na aba Config." });
  res.json(huntSummary(await runMonitor(m)));
}));

app.delete("/api/monitors/:id", (req, res) => {
  const db = get();
  db.monitors = db.monitors.filter((m) => m.id !== req.params.id);
  save();
  res.status(204).end();
});

// ---------- alertas ----------
app.get("/api/alerts", (req, res) => res.json(get().alerts.slice().reverse()));

app.post("/api/alerts/read", (req, res) => {
  for (const a of get().alerts) a.read = true;
  save();
  res.status(204).end();
});

// ---------- config ----------
app.get("/api/settings", (req, res) => res.json(publicSettings()));

app.put("/api/settings", (req, res) => {
  setSettings(req.body || {});
  res.json(publicSettings());
});

app.use(express.static(path.join(here, "..", "public")));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 4444;
app.listen(PORT, HOST, () => {
  console.log(`init4sec rodando em http://${HOST}:${PORT}`);
  startScheduler();
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { flush(); process.exit(0); });
