// Orquestra uma caça: monta queries, coleta no X, enriquece e gera o briefing.
import { get, save, uid, pruneHistory } from "./store.js";
import { cfg } from "./config.js";
import { buildQueries, searchX } from "./collectors/x.js";
import { aggregateIocs, matchTargets } from "./intel/iocs.js";
import { aiBriefing, localBriefing } from "./intel/briefing.js";

export async function runHunt({ name, keywords = [], mode = "sources", hours = 72, sourceIds = null, origin = "manual" }) {
  const db = get();
  const sources = db.sources.filter((s) => s.enabled && (!sourceIds || sourceIds.includes(s.id)));
  const reliability = new Map(sources.map((s) => [s.handle.toLowerCase(), s.reliability]));
  keywords = keywords.map((k) => String(k).trim()).filter(Boolean);

  const hunt = {
    id: uid(),
    name: name || (keywords.length ? keywords.join(", ") : "Radar geral"),
    origin,
    mode,
    hours,
    keywords,
    started_at: new Date().toISOString(),
    status: "running",
    warnings: [],
  };
  db.hunts.push(hunt);
  save();

  try {
    const queries = buildQueries({ keywords, handles: sources.map((s) => s.handle), mode });
    hunt.queries = queries.map((q) => q.q);
    const { posts, warnings, requests } = await searchX({ queries, hours });
    hunt.warnings.push(...warnings);
    hunt.requests = requests;

    for (const p of posts) {
      p.source_reliability = reliability.get(p.author.username.toLowerCase()) ?? null;
      p.matched_targets = matchTargets([p.text, ...p.urls].join(" "), keywords);
    }
    const iocs = aggregateIocs(posts);

    let briefing;
    if (cfg("ANTHROPIC_API_KEY") && posts.length) {
      try {
        briefing = await aiBriefing({ posts, targets: keywords, hours });
      } catch (err) {
        hunt.warnings.push(`Briefing com IA falhou (${err.message}); usando resumo local.`);
      }
    }
    briefing ??= localBriefing({ posts, targets: keywords, iocs });

    Object.assign(hunt, { posts, iocs, briefing, status: "done", finished_at: new Date().toISOString() });
  } catch (err) {
    Object.assign(hunt, { status: "error", error: err.message, finished_at: new Date().toISOString() });
  }
  pruneHistory();
  save();
  return hunt;
}

export function huntSummary(h) {
  return {
    id: h.id,
    name: h.name,
    origin: h.origin,
    mode: h.mode,
    hours: h.hours,
    keywords: h.keywords,
    started_at: h.started_at,
    finished_at: h.finished_at,
    status: h.status,
    error: h.error,
    posts: h.posts?.length ?? 0,
    hits: h.posts?.filter((p) => p.matched_targets?.length).length ?? 0,
    threat_level: h.briefing?.threat_level,
    headline: h.briefing?.headline,
  };
}
