// Monitores: repetem uma caça em intervalo fixo e alertam quando surgem posts novos
// que mencionam os alvos. O alerta vai para a aba "Alertas" e, opcionalmente, para um webhook.
import { get, save, uid } from "./store.js";
import { runHunt } from "./hunt.js";

const TICK_MS = 60 * 1000;
let running = false;

async function notifyWebhook(url, payload) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // "content" é o campo de Discord; "text" o de Slack/Teams. Os demais vão em JSON.
      body: JSON.stringify({ content: payload.message, text: payload.message, ...payload }),
    });
  } catch (err) {
    console.error(`[monitor] webhook falhou: ${err.message}`);
  }
}

export async function runMonitor(monitor) {
  const hunt = await runHunt({
    name: `Monitor: ${monitor.name}`,
    keywords: monitor.keywords,
    mode: monitor.mode,
    hours: Math.max(1, Math.ceil(monitor.interval_minutes / 60) + 1),
    origin: `monitor:${monitor.id}`,
  });
  monitor.last_run = hunt.finished_at;
  monitor.last_hunt = hunt.id;
  monitor.last_status = hunt.status;

  const seen = new Set(monitor.seen_ids || []);
  const fresh = (hunt.posts || []).filter((p) => !seen.has(p.id) && p.matched_targets?.length);
  monitor.seen_ids = [...seen, ...(hunt.posts || []).map((p) => p.id)].slice(-2000);

  if (fresh.length) {
    const alert = {
      id: uid(),
      at: new Date().toISOString(),
      monitor_id: monitor.id,
      hunt_id: hunt.id,
      count: fresh.length,
      threat_level: hunt.briefing?.threat_level,
      message: `[init4sec] ${monitor.name}: ${fresh.length} novo(s) post(s) mencionando ${monitor.keywords.join(", ")} — ${hunt.briefing?.headline || ""}`,
      post_urls: fresh.slice(0, 10).map((p) => p.url),
      read: false,
    };
    get().alerts.push(alert);
    if (monitor.webhook) await notifyWebhook(monitor.webhook, alert);
  }
  save();
  return hunt;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const m of get().monitors) {
      if (!m.enabled) continue;
      const due = !m.last_run || now - new Date(m.last_run).getTime() >= m.interval_minutes * 60 * 1000;
      if (due) await runMonitor(m);
    }
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setInterval(() => tick().catch((e) => console.error("[monitor]", e)), TICK_MS).unref();
}
