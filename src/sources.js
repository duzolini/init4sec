// Fontes curadas no X que costumam divulgar vazamentos, reivindicações de ransomware,
// venda de acessos e atividade hacktivista. A lista é um ponto de partida: valide os
// handles pela UI ("Validar no X") e ajuste a confiabilidade conforme sua experiência.
//
// reliability: 1 (rumor) .. 5 (altamente confiável) — pesa no score de risco.
export const DEFAULT_SOURCES = [
  { handle: "FalconFeedsio", category: "leak-tracker", reliability: 4, note: "Feed de TI: vazamentos, ransomware, venda de acessos" },
  { handle: "H4ckmanac", category: "ransomware-tracker", reliability: 4, note: "HackManac — monitoramento de leak sites de ransomware" },
  { handle: "DarkWebInformer", category: "leak-tracker", reliability: 3, note: "Postagens de fóruns e leak sites da dark web" },
  { handle: "darktracer_int", category: "ransomware-tracker", reliability: 4, note: "DarkTracer — inteligência de leak sites e stealers" },
  { handle: "ido_cohen2", category: "ransomware-tracker", reliability: 3, note: "Monitor de novas vítimas em leak sites" },
  { handle: "AlvieriD", category: "researcher", reliability: 4, note: "Dominic Alvieri — rastreio de vazamentos e ransomware" },
  { handle: "BrettCallow", category: "researcher", reliability: 4, note: "Analista de ransomware" },
  { handle: "JMousqueton", category: "ransomware-tracker", reliability: 4, note: "Julien Mousqueton — ransomware.live" },
  { handle: "Cyberknow20", category: "hacktivism", reliability: 3, note: "Hacktivismo, DDoS e grupos de ransomware" },
  { handle: "DailyDarkWeb", category: "leak-tracker", reliability: 3, note: "Resumo diário de dark web" },
  { handle: "IntCyberDigest", category: "news", reliability: 3, note: "International Cyber Digest" },
  { handle: "vxunderground", category: "researcher", reliability: 4, note: "Malware, ransomware, bastidores do cibercrime" },
  { handle: "MalwareHunterTeam", category: "researcher", reliability: 4, note: "Amostras de malware e ransomware" },
  { handle: "PogoWasRight", category: "news", reliability: 4, note: "DataBreaches.net" },
  { handle: "troyhunt", category: "researcher", reliability: 5, note: "Have I Been Pwned" },
  { handle: "HackRead", category: "news", reliability: 3, note: "Notícias de vazamentos" },
  { handle: "BleepinComputer", category: "news", reliability: 4, note: "Notícias de segurança" },
  { handle: "TheHackersNews", category: "news", reliability: 3, note: "Notícias de segurança" },
  { handle: "CISAgov", category: "advisory", reliability: 5, note: "Alertas e KEV" },
  { handle: "cisoadvisor", category: "news-br", reliability: 3, note: "Notícias de segurança no Brasil" },
];

export const SOURCE_CATEGORIES = [
  "leak-tracker",
  "ransomware-tracker",
  "researcher",
  "hacktivism",
  "news",
  "news-br",
  "advisory",
  "threat-actor",
  "other",
];
