function parseInput(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
}

const options = parseInput(typeof $options !== "undefined" ? $options : undefined);
const argumentsInput = parseInput(typeof $arguments !== "undefined" ? $arguments : undefined);
const requestQuery = parseInput(options._req && options._req.query);
const input = { ...options, ...requestQuery, ...argumentsInput };

const rawFileContent = typeof $content === "string" ? $content : "";
const $ = typeof $substore !== "undefined" ? $substore : null;

const ORZ3 = "https://gcore.jsdelivr.net/gh/Orz-3/mini@master/Color";
const LOCAL_ICON = "https://raw.githubusercontent.com/cnzakii/rule_script/main/icon";
const EDC_FILTER = "https://raw.githubusercontent.com/erdongchanyo/icon/main/Policy-Filter";
const EDC_COUNTRY = "https://raw.githubusercontent.com/erdongchanyo/icon/main/Policy-Country";
const TEST_URL = "https://cp.cloudflare.com/generate_204";
const LANDING_GROUP = "落地选择";
const LANDING_FRONT_GROUP = "落地前置";
const LANDING_CHAIN = "落地代理";

const REGIONS = [
  { name: "香港", pattern: "香港|港|HK|Hong Kong|HongKong|🇭🇰", icon: `${EDC_COUNTRY}/HK02.png` },
  { name: "台湾", pattern: "台|新北|彰化|TW|Taiwan|🇹🇼|🇨🇳", icon: `${EDC_COUNTRY}/CN.png` },
  { name: "新加坡", pattern: "新加坡|坡|狮城|SG|Singapore|🇸🇬", icon: `${EDC_COUNTRY}/SG.png` },
  { name: "日本", pattern: "日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵", icon: `${EDC_COUNTRY}/JP.png` },
  { name: "美国", pattern: "美国|美|US|United States|🇺🇸", icon: `${EDC_COUNTRY}/US.png` },
];

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const CONFIG = {
  officialUrl: String(input.officialUrl || input.official || input.source || ""),
  disableDoH: asBool(input.disableDoH, false),
  chainUdp: asBool(input.chainUdp, false),
  testUrl: String(input.testUrl || TEST_URL),
  interval: asInt(input.interval, 300),
  tolerance: asInt(input.tolerance, 50),
  timeout: asInt(input.timeout, 30000),
};

function normalizeSectionName(name) {
  return String(name || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function readSection(content, names) {
  const wanted = new Set([].concat(names).map(normalizeSectionName));
  const out = [];
  let inSection = false;
  let found = false;

  for (const line of String(content || "").split(/\r?\n/)) {
    const title = line.trim().match(/^\[([^\]]+)\]$/);
    if (title) {
      if (inSection) break;
      inSection = wanted.has(normalizeSectionName(title[1]));
      if (inSection) found = true;
      continue;
    }
    if (inSection) out.push(line);
  }

  return { found, body: out.join("\n").trim() };
}

function stripEmptyAndComments(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"))
    .join("\n");
}

function remoteName(line) {
  return String(line).split("=")[0].trim();
}

function remoteIcon(name) {
  if (/landing|落地/i.test(name)) return `${EDC_FILTER}/Proxy.png`;
  if (/self|built|自建/i.test(name)) return `${EDC_COUNTRY}/JP.png`;
  return `${EDC_FILTER}/Proxy.png`;
}

function extractRemoteProxyLines(content) {
  const remoteSection = readSection(content, ["Remote Proxy", "Remote-proxy", "RemoteProxy"]);
  const source = remoteSection.found ? remoteSection.body : content;
  const out = [];
  const seen = new Set();

  for (const raw of String(source || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || /^\[.+\]$/.test(line)) continue;
    if (!/^([^=]+)=\s*https?:\/\//i.test(line)) continue;

    const name = remoteName(line);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    let normalized = line;
    if (!/[,\s]enabled\s*=/i.test(normalized)) normalized += ", enabled=true";
    if (!/[,\s]img-url\s*=/i.test(normalized)) normalized += `, img-url=${remoteIcon(name)}`;
    out.push(normalized);
  }

  if (!out.length) throw new Error("missing [Remote Proxy] lines in file content");
  return out;
}

function classifyRemotes(names) {
  const landing = [];
  const self = [];
  const airport = [];

  for (const name of names) {
    if (/landing|落地/i.test(name)) landing.push(name);
    else if (/self|built|自建/i.test(name)) self.push(name);
    else airport.push(name);
  }

  return { airport, self, landing };
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function csv(items) {
  return uniq(items).join(", ");
}

function safeFilterName(text) {
  return String(text).replace(/[,\[\]=]/g, "-").trim();
}

async function httpGet(url) {
  if (!$ || !$.http || !$.http.get) throw new Error("$substore.http.get is unavailable");

  const res = await $.http.get({
    url,
    timeout: CONFIG.timeout,
    headers: { "user-agent": "Loon/3.0", accept: "*/*" },
  });

  if (typeof res === "string") return res;
  if (res && typeof res.body === "string") return res.body;
  if (res && typeof res.data === "string") return res.data;

  throw new Error(`empty response from ${url}`);
}

async function loadOfficialSections() {
  if (!CONFIG.officialUrl) throw new Error("missing argument: officialUrl");

  const official = await httpGet(CONFIG.officialUrl);
  let general = readSection(official, "General").body;

  if (!general) throw new Error("officialUrl did not return a Loon profile with [General]");

  if (CONFIG.disableDoH) {
    general = general
      .split(/\r?\n/)
      .filter((line) => !/^\s*doh-server\s*=/i.test(line))
      .join("\n");
  }

  return {
    general: stripEmptyAndComments(general),
    host: passthroughSection(official, "Host").body,
  };
}

function filterModel(remoteNames) {
  const { airport, self, landing } = classifyRemotes(remoteNames);
  const regionFilters = {};
  const remoteFilterLines = [];

  for (const region of REGIONS) {
    const sources = region.name === "日本" ? [...airport, ...self] : airport;
    regionFilters[region.name] = [];

    for (const source of uniq(sources)) {
      const filterName = `Filter-${region.name}-${safeFilterName(source)}`;
      regionFilters[region.name].push(filterName);
      remoteFilterLines.push(`${filterName} = NameRegex, ${source}, FilterKey = "${region.pattern}"`);
    }
  }

  const landingFilters = [];
  for (const source of uniq(landing)) {
    const filterName = `Filter-落地-${safeFilterName(source)}`;
    landingFilters.push(filterName);
    remoteFilterLines.push(`${filterName} = NameRegex, ${source}, FilterKey = "."`);
  }

  return { regionFilters, landingFilters, remoteFilterLines };
}

function groupLine(name, type, policies, icon, extra = "") {
  const suffix = extra ? `, ${extra}` : "";
  const iconPart = icon ? `, img-url = ${icon}` : "";
  return `${name} = ${type}, ${csv(policies)}${suffix}${iconPart}`;
}

function buildProxyGroups(remoteNames) {
  const { airport, self, landing } = classifyRemotes(remoteNames);
  const { regionFilters, landingFilters } = filterModel(remoteNames);
  const hasLanding = landing.length > 0;
  const regionNames = REGIONS.map((region) => region.name).filter((name) => (regionFilters[name] || []).length > 0);
  const landingOption = hasLanding ? [LANDING_CHAIN] : [];
  const proxyFirst = ["代理选择", ...landingOption, ...regionNames, "手动选择", "DIRECT"];
  const directFirst = ["DIRECT", "代理选择", ...landingOption, ...regionNames, "手动选择"];

  const groups = [];

  groups.push(groupLine("代理选择", "select", ["手动选择", ...landingOption, ...(hasLanding ? [LANDING_FRONT_GROUP, LANDING_GROUP] : []), ...regionNames, "DIRECT"], `${EDC_FILTER}/Proxy.png`));
  groups.push(groupLine("手动选择", "select", [...airport, ...self, "DIRECT"], `${ORZ3}/Static.png`));

  if (hasLanding) {
    groups.push(groupLine(LANDING_FRONT_GROUP, "select", ["手动选择", ...regionNames, "DIRECT"], `${EDC_FILTER}/Proxy.png`));
    groups.push(groupLine(LANDING_GROUP, "select", landingFilters, `${EDC_FILTER}/Proxy.png`));
  }

  for (const region of REGIONS) {
    const filters = regionFilters[region.name] || [];
    if (!filters.length) continue;
    groups.push(groupLine(region.name, "url-test", filters, region.icon, `url = ${CONFIG.testUrl}, interval = ${CONFIG.interval}, tolerance = ${CONFIG.tolerance}`));
  }

  const serviceGroups = [
    { name: "OpenAI", icon: `${EDC_FILTER}/OpenAI.png`, policies: proxyFirst },
    { name: "Anthropic", icon: `${LOCAL_ICON}/claude.png`, policies: proxyFirst },
    { name: "Gemini", icon: `${LOCAL_ICON}/gemini.png`, policies: proxyFirst },
    { name: "Telegram", icon: `${EDC_FILTER}/Telegram.png`, policies: proxyFirst },
    { name: "GitHub", icon: `${LOCAL_ICON}/github.png`, policies: proxyFirst },
    { name: "Discord", icon: `${LOCAL_ICON}/discord.png`, policies: proxyFirst },
    { name: "Twitter", icon: `${EDC_FILTER}/Twitter.png`, policies: proxyFirst },
    { name: "YouTube", icon: `${EDC_FILTER}/Youtube.png`, policies: proxyFirst },
    { name: "Google", icon: `${EDC_FILTER}/Google.png`, policies: proxyFirst },
    { name: "Microsoft", icon: `${EDC_FILTER}/Microsoft.png`, policies: proxyFirst },
    { name: "Netflix", icon: `${EDC_FILTER}/Netflix.png`, policies: proxyFirst },
    { name: "Spotify", icon: `${EDC_FILTER}/Spotify.png`, policies: proxyFirst },
    { name: "TikTok", icon: `${EDC_FILTER}/Tiktok.png`, policies: proxyFirst },
    { name: "Bilibili", icon: `${EDC_FILTER}/Bilibili.png`, policies: proxyFirst },
    { name: "Bahamut", icon: `${LOCAL_ICON}/bahamut.png`, policies: proxyFirst },
    { name: "游戏", icon: `${EDC_FILTER}/Game.png`, policies: proxyFirst },
    { name: "GlobalMedia", icon: `${EDC_FILTER}/GMedia.png`, policies: proxyFirst },
    { name: "Speedtest", icon: `${EDC_FILTER}/Speedtest.png`, policies: directFirst },
    { name: "Apple", icon: `${EDC_FILTER}/Apple.png`, policies: directFirst },
    { name: "广告拦截", icon: `${EDC_FILTER}/AdBlock.png`, policies: ["REJECT", "DIRECT"] },
    { name: "国内网站", icon: `${EDC_FILTER}/Mainland.png`, policies: directFirst },
    { name: "Final", icon: `${EDC_FILTER}/Final.png`, policies: proxyFirst },
  ];

  for (const group of serviceGroups) {
    groups.push(groupLine(group.name, "select", group.policies, group.icon));
  }

  return groups.filter((line) => !/[,，]\s*[,，]/.test(line));
}

function buildProxyChains(remoteNames) {
  const { landing } = classifyRemotes(remoteNames);
  if (!landing.length) return [];
  return [`${LANDING_CHAIN} = ${LANDING_FRONT_GROUP}, ${LANDING_GROUP}${CONFIG.chainUdp ? ", udp=true" : ""}`];
}

const B7 = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Loon";

function remoteRule(path, policy, tag = path) {
  return `${B7}/${path}/${path}.list, policy=${policy}, tag=${tag}, enabled=true`;
}

function buildRemoteRules() {
  return [
    remoteRule("Lan", "DIRECT", "Lan"),
    remoteRule("Direct", "DIRECT", "Direct"),
    remoteRule("Advertising", "广告拦截", "Advertising"),
    remoteRule("OpenAI", "OpenAI", "OpenAI"),
    remoteRule("Claude", "Anthropic", "Claude"),
    remoteRule("Anthropic", "Anthropic", "Anthropic"),
    remoteRule("Gemini", "Gemini", "Gemini"),
    remoteRule("Telegram", "Telegram", "Telegram"),
    remoteRule("GitHub", "GitHub", "GitHub"),
    remoteRule("Discord", "Discord", "Discord"),
    remoteRule("Twitter", "Twitter", "Twitter"),
    remoteRule("Speedtest", "Speedtest", "Speedtest"),
    remoteRule("Game", "游戏", "Game"),
    remoteRule("YouTube", "YouTube", "YouTube"),
    remoteRule("Netflix", "Netflix", "Netflix"),
    remoteRule("Spotify", "Spotify", "Spotify"),
    remoteRule("TikTok", "TikTok", "TikTok"),
    remoteRule("BiliBiliIntl", "Bilibili", "BiliBiliIntl"),
    remoteRule("BiliBili", "Bilibili", "BiliBili"),
    remoteRule("Bahamut", "Bahamut", "Bahamut"),
    remoteRule("GlobalMedia", "GlobalMedia", "GlobalMedia"),
    remoteRule("Google", "Google", "Google"),
    remoteRule("Microsoft", "Microsoft", "Microsoft"),
    remoteRule("Apple", "Apple", "Apple"),
    remoteRule("ChinaNoMedia", "国内网站", "ChinaNoMedia"),
    remoteRule("ChinaIPs", "国内网站", "ChinaIPs"),
    remoteRule("Proxy", "Final", "Proxy"),
  ];
}

function buildLocalRules() {
  return [
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "GEOIP,CN,国内网站",
    "FINAL,Final",
  ];
}

function passthroughSection(content, names) {
  const section = readSection(content, names);
  return { found: section.found, body: stripEmptyAndComments(section.body) };
}

function pluginSection(content) {
  const section = readSection(content, "Plugin");
  if (!section.found) return { found: false, body: "" };
  const body = stripEmptyAndComments(section.body)
    .split(/\n/)
    .filter((line) => !/boxjs/i.test(line))
    .join("\n");
  return { found: true, body };
}

async function main() {
  const remoteProxyLines = extractRemoteProxyLines(rawFileContent);
  const remoteNames = remoteProxyLines.map(remoteName);
  const { general, host } = await loadOfficialSections();
  const { remoteFilterLines } = filterModel(remoteNames);
  const proxyChains = buildProxyChains(remoteNames);

  const parts = [];
  parts.push(`[General]\n${general}`);
  if (host) parts.push(`[Host]\n${host}`);
  parts.push(`[Remote Proxy]\n${remoteProxyLines.join("\n")}`);
  parts.push(`[Remote Filter]\n${remoteFilterLines.join("\n")}`);
  parts.push(`[Proxy Group]\n${buildProxyGroups(remoteNames).join("\n")}`);
  if (proxyChains.length) parts.push(`[Proxy Chain]\n${proxyChains.join("\n")}`);
  parts.push(`[Remote Rule]\n${buildRemoteRules().join("\n")}`);
  parts.push(`[Rule]\n${buildLocalRules().join("\n")}`);

  const plugins = pluginSection(rawFileContent);
  if (plugins.found && plugins.body) parts.push(`[Plugin]\n${plugins.body}`.trimEnd());

  const mitm = passthroughSection(rawFileContent, ["MITM", "Mitm"]);
  if (mitm.found) parts.push(`[MITM]\n${mitm.body}`.trimEnd());

  return parts.join("\n\n") + "\n";
}

$content = await main();
