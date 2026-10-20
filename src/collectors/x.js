// Coletor da X API v2 (search/recent — janela de até 7 dias).
// Monta queries respeitando o limite de tamanho do plano, pagina, normaliza e deduplica.
import { cfg } from "../config.js";

const API = "https://api.x.com/2";

// Léxico usado na "caça global" (busca em todo o X, não só nas fontes curadas)
export const LEAK_LEXICON = [
  "leak", "leaked", "breach", "ransomware", "dump", "\"data breach\"", "\"for sale\"",
  "vazamento", "vazou", "\"dados vazados\"", "hacked", "exfiltrated",
];

export class XApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function quoteTerm(term) {
  const t = String(term).trim().replace(/"/g, "");
  if (!t) return "";
  // Termos simples alfanuméricos vão sem aspas; o resto vira frase exata
  return /^[\p{L}\p{N}_]+$/u.test(t) ? t : `"${t}"`;
}

function orClause(parts) {
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

// Agrupa itens em cláusulas OR que caibam em `budget` caracteres
function packOr(items, budget) {
  const groups = [];
  let cur = [];
  for (const item of items) {
    const next = [...cur, item];
    if (cur.length && orClause(next).length > budget) {
      groups.push(cur);
      cur = [item];
    } else {
      cur = next;
    }
  }
  if (cur.length) groups.push(cur);
  return groups.map(orClause);
}

/**
 * Monta as queries da X API.
 * mode: "sources" (from: fontes curadas), "global" (todo o X + léxico de vazamento) ou "hybrid".
 */
export function buildQueries({ keywords = [], handles = [], mode = "sources", excludeRetweets = true, maxLen }) {
  maxLen = Number(maxLen || cfg("X_QUERY_MAX_LEN") || 512);
  const suffix = excludeRetweets ? " -is:retweet" : "";
  const kws = keywords.map(quoteTerm).filter(Boolean);
  const froms = handles.map((h) => `from:${String(h).replace(/^@/, "").trim()}`).filter((f) => f !== "from:");
  const queries = [];

  if (mode === "sources" || mode === "hybrid") {
    if (froms.length === 0 && mode === "sources") throw new Error("Nenhuma fonte habilitada para a busca.");
    const kwGroups = kws.length ? packOr(kws, Math.floor(maxLen * 0.45)) : [""];
    for (const kw of kwGroups) {
      const budget = maxLen - kw.length - suffix.length - 1;
      for (const fromClause of packOr(froms, budget)) {
        queries.push({ kind: "sources", q: `${kw} ${fromClause}${suffix}`.trim() });
      }
    }
  }

  if (mode === "global" || mode === "hybrid") {
    if (kws.length === 0) throw new Error("A caça global exige ao menos um alvo/palavra-chave.");
    const lex = orClause(LEAK_LEXICON);
    const budget = maxLen - lex.length - suffix.length - 1;
    for (const kw of packOr(kws, budget)) {
      queries.push({ kind: "global", q: `${kw} ${lex}${suffix}`.trim() });
    }
  }

  return queries;
}

async function xGet(pathAndQuery, token) {
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "init4sec/0.1" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reset = res.headers.get("x-rate-limit-reset");
    const msg =
      res.status === 429
        ? `Rate limit da X API atingido${reset ? ` — libera às ${new Date(Number(reset) * 1000).toLocaleTimeString("pt-BR")}` : ""}`
        : res.status === 401
          ? "Token da X API inválido (401)"
          : res.status === 403
            ? "Acesso negado pela X API (403) — seu plano pode não incluir search/recent"
            : `Erro da X API (${res.status})`;
    throw new XApiError(msg, res.status, body);
  }
  return body;
}

function normalize(tweet, users, media, query) {
  const author = users.get(tweet.author_id) || {};
  const urls = (tweet.entities?.urls || []).map((u) => u.unwound_url || u.expanded_url || u.url).filter(Boolean);
  const mediaUrls = (tweet.attachments?.media_keys || [])
    .map((k) => media.get(k))
    .filter(Boolean)
    .map((m) => m.url || m.preview_image_url)
    .filter(Boolean);
  return {
    id: tweet.id,
    text: tweet.note_tweet?.text || tweet.text,
    created_at: tweet.created_at,
    lang: tweet.lang,
    author: {
      id: tweet.author_id,
      username: author.username || "desconhecido",
      name: author.name || "",
      verified: Boolean(author.verified),
      followers: author.public_metrics?.followers_count ?? null,
    },
    metrics: tweet.public_metrics || {},
    urls,
    media: mediaUrls,
    url: `https://x.com/${author.username || "i"}/status/${tweet.id}`,
    matched_by: query.kind,
  };
}

/**
 * Executa as queries e devolve posts normalizados + avisos (rate limit, limites atingidos etc.).
 */
export async function searchX({ queries, hours = 72, maxPagesPerQuery = 2, maxQueries = 12 }) {
  const token = cfg("X_BEARER_TOKEN");
  if (!token) throw new XApiError("X_BEARER_TOKEN não configurado", 0);

  const warnings = [];
  const posts = new Map();
  // search/recent só aceita até 7 dias e start_time precisa estar ao menos 10s no passado
  const h = Math.min(Math.max(Number(hours) || 72, 1), 167);
  const startTime = new Date(Date.now() - h * 3600 * 1000).toISOString();

  if (queries.length > maxQueries) {
    warnings.push(`${queries.length} queries necessárias; executando apenas ${maxQueries} para poupar sua cota. Reduza fontes/alvos ou aumente X_QUERY_MAX_LEN se seu plano permitir.`);
  }

  let requests = 0;
  outer: for (const query of queries.slice(0, maxQueries)) {
    let nextToken = null;
    for (let page = 0; page < maxPagesPerQuery; page++) {
      const params = new URLSearchParams({
        query: query.q,
        max_results: "100",
        start_time: startTime,
        "tweet.fields": "created_at,author_id,public_metrics,entities,lang,note_tweet,attachments",
        expansions: "author_id,attachments.media_keys",
        "user.fields": "username,name,verified,public_metrics",
        "media.fields": "url,preview_image_url,type",
      });
      if (nextToken) params.set("next_token", nextToken);
      let body;
      try {
        body = await xGet(`/tweets/search/recent?${params}`, token);
        requests++;
      } catch (err) {
        if (err instanceof XApiError && err.status === 429) {
          warnings.push(err.message + ". Resultados parciais.");
          break outer;
        }
        throw err;
      }
      const users = new Map((body.includes?.users || []).map((u) => [u.id, u]));
      const media = new Map((body.includes?.media || []).map((m) => [m.media_key, m]));
      for (const t of body.data || []) {
        if (!posts.has(t.id)) posts.set(t.id, normalize(t, users, media, query));
      }
      nextToken = body.meta?.next_token;
      if (!nextToken) break;
    }
  }

  return {
    posts: [...posts.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    warnings,
    requests,
  };
}

// Valida handles (existência, seguidores, descrição) — até 100 por chamada
export async function lookupUsers(handles) {
  const token = cfg("X_BEARER_TOKEN");
  if (!token) throw new XApiError("X_BEARER_TOKEN não configurado", 0);
  const result = {};
  for (let i = 0; i < handles.length; i += 100) {
    const chunk = handles.slice(i, i + 100).map((h) => h.replace(/^@/, ""));
    const params = new URLSearchParams({
      usernames: chunk.join(","),
      "user.fields": "description,public_metrics,verified,created_at",
    });
    const body = await xGet(`/users/by?${params}`, token);
    for (const u of body.data || []) {
      result[u.username.toLowerCase()] = {
        ok: true,
        name: u.name,
        description: u.description,
        followers: u.public_metrics?.followers_count,
        verified: u.verified,
      };
    }
    for (const e of body.errors || []) {
      const name = (e.value || "").toLowerCase();
      if (name) result[name] = { ok: false, error: e.detail || e.title };
    }
  }
  return result;
}
