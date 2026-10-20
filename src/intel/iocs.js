// Extração de indicadores técnicos (IOCs) de textos públicos, para triagem e bloqueio.
// Os posts chegam "defanged" com frequência (hxxp, [.] ), então normalizamos antes.

const PATTERNS = {
  cve: /\bCVE-\d{4}-\d{4,7}\b/gi,
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  sha256: /\b[a-f0-9]{64}\b/gi,
  sha1: /\b[a-f0-9]{40}\b/gi,
  md5: /\b[a-f0-9]{32}\b/gi,
  email: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  domain: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24})\b/gi,
};

// Domínios que aparecem em quase todo post e não são indicadores úteis
const NOISE_DOMAINS = new Set(["x.com", "twitter.com", "t.co", "pic.twitter.com", "youtube.com", "youtu.be", "linkedin.com", "github.com"]);
const FILE_EXT = /\.(png|jpe?g|gif|pdf|txt|zip|rar|7z|csv|sql|json|js|html?|php)$/i;

export function refang(text) {
  return String(text)
    .replace(/hxxp/gi, "http")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]/gi, ".")
    .replace(/\[@\]|\[at\]/gi, "@");
}

export function extractIocs(text) {
  const t = refang(text);
  const out = {};
  for (const [kind, re] of Object.entries(PATTERNS)) {
    out[kind] = [...new Set((t.match(re) || []).map((v) => (kind === "cve" ? v.toUpperCase() : v.toLowerCase())))];
  }
  // Remove hashes menores contidos em maiores e domínios que são, na verdade, e-mails/ruído
  out.sha1 = out.sha1.filter((h) => !out.sha256.some((s) => s.includes(h)));
  out.md5 = out.md5.filter((h) => ![...out.sha256, ...out.sha1].some((s) => s.includes(h)));
  const emailDomains = new Set(out.email.map((e) => e.split("@")[1]));
  out.domain = out.domain.filter(
    (d) => !NOISE_DOMAINS.has(d) && !emailDomains.has(d) && !FILE_EXT.test(d) && !/^\d+(\.\d+)+$/.test(d),
  );
  return out;
}

// Consolida IOCs de vários posts, guardando em quais posts cada um apareceu
export function aggregateIocs(posts) {
  const agg = {};
  for (const p of posts) {
    const iocs = extractIocs([p.text, ...(p.urls || [])].join(" "));
    p.iocs = iocs;
    for (const [kind, values] of Object.entries(iocs)) {
      for (const v of values) {
        const key = `${kind}:${v}`;
        agg[key] ??= { kind, value: v, posts: [] };
        agg[key].posts.push(p.id);
      }
    }
  }
  return Object.values(agg).sort((a, b) => b.posts.length - a.posts.length);
}

// Verifica se o post menciona algum dos alvos monitorados
export function matchTargets(text, targets) {
  const t = refang(text).toLowerCase();
  return targets.filter((k) => k && t.includes(String(k).toLowerCase()));
}
