/**
 * Sub-Store Mihomo 订阅转换脚本
 * - 普通 file + Script Operator：通过 operator(input) 解析 $content
 * - mihomoProfile：通过 main(config) 处理配置
 *
 * 支持参数：
 * - minCount:     节点数量低于该值的地区归入"其他地区"（默认 0）
 * - groupType:      地区分组默认策略 select / url-test / load-balance（默认 url-test）
 * - groupOverride:  覆盖特定分组类型，格式 "香港:select,美国:load-balance"
 * - enableLanding:  启用落地节点 dialer-proxy（默认 false）
 * - landingKeyword: 落地节点名称匹配正则（默认 "落地|自建|家宽|住宅"）
 * - nodeSourceType: 从 Sub-Store 拉取节点的来源类型 subscription / collection（默认 collection）
 * - nodeSourceName: 从 Sub-Store 拉取节点的来源名称，例如 Mix-Landing（默认空，不拉取）
 * - nodeMode:       replace / preserve；拉取节点后默认 replace
 * - dnsMode:        preserve / off / custom（默认 preserve，保留官方 DNS）
 * - snifferMode:    preserve / off / custom（默认 preserve）
 * - coreMode:       preserve / custom（默认 preserve）
 * - groupsMode:     custom / preserve（默认 custom）
 * - rulesMode:      custom / preserve（默认 custom）
 * - mediaMode:      balanced / full（默认 balanced；full 增加 Disney/Max/PrimeVideo/AppleTV）
 * - ruleProviderProxy: 规则集下载使用的策略组（默认 代理选择）
 */

const ORZ3 = "https://gcore.jsdelivr.net/gh/Orz-3/mini@master/Color";
const LOCAL_ICON = "https://raw.githubusercontent.com/cnzakii/rule_script/main/icon";
const EDC_FILTER = "https://raw.githubusercontent.com/erdongchanyo/icon/main/Policy-Filter";
const EDC_COUNTRY = "https://raw.githubusercontent.com/erdongchanyo/icon/main/Policy-Country";
const VALID_GROUP_TYPES = ["select", "url-test", "load-balance"];
const TLS_FINGERPRINT_TYPES = new Set(["vmess", "vless", "trojan", "anytls"]);
const TEST_URL = "https://cp.cloudflare.com/generate_204";
const LANDING_GROUP = "落地选择";
const LANDING_FRONT_GROUP = "落地前置";
const DEFAULT_LANDING_KEYWORD = "落地|自建|家宽|住宅";

// ====== 规则集来源 ======
const DUSTIN = "https://raw.githubusercontent.com/DustinWin/ruleset_geodata/mihomo-ruleset";
const META_LITE = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo-lite/geosite";
const META_FULL = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite";

// ====== 地区元数据 ======
const regions = [
    { name: "香港",     pattern: "香港|港|HK|Hong Kong|HongKong|🇭🇰",                icon: `${EDC_COUNTRY}/HK02.png` },
    { name: "台湾",     pattern: "台|新北|彰化|TW|Taiwan|🇹🇼|🇨🇳",                    icon: `${EDC_COUNTRY}/CN.png` },
    { name: "新加坡",   pattern: "新加坡|坡|狮城|SG|Singapore|🇸🇬",                    icon: `${EDC_COUNTRY}/SG.png` },
    { name: "日本",     pattern: "日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵", icon: `${EDC_COUNTRY}/JP.png` },
    { name: "韩国",     pattern: "KR|Korea|KOR|首尔|韩|韓|🇰🇷",                        icon: `${EDC_COUNTRY}/KR.png` },
    { name: "美国",     pattern: "美国|美|US|United States|🇺🇸",                        icon: `${EDC_COUNTRY}/US.png` },
    { name: "加拿大",   pattern: "加拿大|Canada|CA|🇨🇦",                                icon: `${EDC_COUNTRY}/CA.png` },
    { name: "英国",     pattern: "英国|United Kingdom|UK|伦敦|London|🇬🇧",              icon: `${EDC_COUNTRY}/UK.png` },
    { name: "法国",     pattern: "法国|法|FR|France|🇫🇷",                               icon: `${EDC_COUNTRY}/FR.png` },
    { name: "德国",     pattern: "德国|德|DE|Germany|🇩🇪",                              icon: `${EDC_COUNTRY}/DE.png` },
    { name: "荷兰",     pattern: "荷兰|NL|Netherlands|🇳🇱",                             icon: `${ORZ3}/NL.png` },
    { name: "澳大利亚", pattern: "澳洲|澳大利亚|AU|Australia|🇦🇺",                     icon: `${EDC_COUNTRY}/AU.png` },
    { name: "俄罗斯",   pattern: "俄罗斯|俄|RU|Russia|🇷🇺",                            icon: `${EDC_COUNTRY}/RU.png` },
    { name: "土耳其",   pattern: "土耳其|TR|Turkey|Türkiye|🇹🇷",                        icon: `${EDC_COUNTRY}/TR.png` },
].map(region => ({ ...region, regex: new RegExp(region.pattern) }));

// ====== 工具函数 ======
const toInt = (v, d = 0) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
const clone = (value) => JSON.parse(JSON.stringify(value));

/** 解析 groupOverride 参数，返回 { 分组名: 类型 } */
function parseGroupOverride(raw) {
    const map = {};
    if (!raw) return map;
    for (const pair of String(raw).split(",")) {
        const [name, type] = pair.split(":").map(s => s.trim());
        if (name && VALID_GROUP_TYPES.includes(type)) map[name] = type;
    }
    return map;
}

/** url-test 公共配置 */
function urlTestOpts() {
    return { url: TEST_URL, interval: 300, tolerance: 50, lazy: false };
}

/** 统计各地区节点数，返回有节点的地区 */
function countByRegion(proxies) {
    const counts = regions.map(region => ({ ...region, count: 0 }));
    let unmatchedCount = 0;

    for (const proxy of proxies) {
        const name = proxy.name || "";
        let matched = false;

        for (const region of counts) {
            if (!region.regex.test(name)) continue;
            region.count += 1;
            matched = true;
        }

        if (!matched) unmatchedCount += 1;
    }

    return {
        stats: counts.filter(region => region.count > 0),
        unmatchedCount,
    };
}

/** 创建单个地区/筛选分组，type 由 override 或 defaultType 决定 */
function makeGroup({ name, match, defaultType, overrideMap, icon, exclude = false, excludeMatch = "" }) {
    const type = overrideMap[name] || defaultType;
    const group = { name, type, "include-all": true };
    if (icon) group.icon = icon;
    if (exclude) group["exclude-filter"] = [match, excludeMatch].filter(Boolean).join("|");
    else {
        group.filter = match;
        if (excludeMatch) group["exclude-filter"] = excludeMatch;
    }
    if (type === "url-test") Object.assign(group, urlTestOpts());
    return group;
}

/** 构建全部地区 + 特殊筛选分组 */
function buildRegionGroups(stats, unmatchedCount, minCount, defaultType, overrideMap, excludeMatch = "") {
    const groups = [];
    const keptPatterns = [];
    let otherCount = unmatchedCount;

    for (const region of stats) {
        if (region.count >= minCount) {
            groups.push(makeGroup({
                name: region.name,
                match: region.pattern,
                defaultType,
                overrideMap,
                icon: region.icon,
                excludeMatch,
            }));
            keptPatterns.push(region.pattern);
            continue;
        }

        otherCount += region.count;
    }

    if (otherCount > 0) {
        groups.push(makeGroup({
            name: "其他地区",
            match: keptPatterns.join("|"),
            defaultType,
            overrideMap,
            icon: `${EDC_FILTER}/Outside.png`,
            exclude: keptPatterns.length > 0,
            excludeMatch,
        }));
    }

    return groups;
}

// ====== DNS 配置 ======
const DNS_CONFIG = {
    "enable": true,
    "prefer-h3": true,
    "ipv6": false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "respect-rules": true,
    "default-nameserver": [
        "223.5.5.5",
        "119.29.29.29",
    ],
    "fake-ip-filter-mode": "rule",
    "fake-ip-filter": [
        // 配置源：大陆域名返回真实 IP
        "RULE-SET,cn,real-ip",
        "GEOSITE,private,real-ip",
        // Tailscale / ZeroTier / WireGuard
        "DOMAIN-SUFFIX,tailscale.com,real-ip",
        "DOMAIN-SUFFIX,tailscale.io,real-ip",
        "DOMAIN-SUFFIX,ts.net,real-ip",
        "DOMAIN-SUFFIX,zerotier.com,real-ip",
        "DOMAIN-SUFFIX,zerotierstatic.com,real-ip",
        "DOMAIN-SUFFIX,wireguard.com,real-ip",
        // STUN
        "DOMAIN-REGEX,^(?:.+\\.)?stun\\..+\\..+$,real-ip",
        // NTP
        "DOMAIN-SUFFIX,ntp.org,real-ip",
        "DOMAIN-REGEX,^time\\..+\\.com$,real-ip",
        "DOMAIN-REGEX,^time\\..+\\.gov$,real-ip",
        "DOMAIN-REGEX,^time\\..+\\.apple\\.com$,real-ip",
        "DOMAIN-REGEX,^time[^.]*\\.cloud\\.tencent\\.com$,real-ip",
        "DOMAIN-REGEX,^ntp\\..+\\.com$,real-ip",
        // 连通性检测
        "DOMAIN-SUFFIX,msftconnecttest.com,real-ip",
        "DOMAIN-SUFFIX,msftncsi.com,real-ip",
        "DOMAIN,localhost.ptlogin2.qq.com,real-ip",
        "DOMAIN,localhost.sec.qq.com,real-ip",
        "DOMAIN-SUFFIX,captive.apple.com,real-ip",
        "DOMAIN,connectivitycheck.gstatic.com,real-ip",
        "DOMAIN,detectportal.firefox.com,real-ip",
        // 局域网 / mDNS
        "DOMAIN-SUFFIX,local,real-ip",
        "DOMAIN-SUFFIX,lan,real-ip",
        "DOMAIN-SUFFIX,home.arpa,real-ip",
        "DOMAIN-SUFFIX,localhost,real-ip",
        // 游戏主机
        "DOMAIN-SUFFIX,srv.nintendo.net,real-ip",
        "DOMAIN-REGEX,^.+\\.n\\.n\\.srv\\.nintendo\\.net$,real-ip",
        "DOMAIN-SUFFIX,stun.playstation.net,real-ip",
        "DOMAIN-REGEX,^xbox\\..+\\.microsoft\\.com$,real-ip",
        "DOMAIN-SUFFIX,xboxlive.com,real-ip",
        "DOMAIN-SUFFIX,battlenet.com.cn,real-ip",
        "DOMAIN-SUFFIX,battlenet.com,real-ip",
        // 其他
        "DOMAIN-SUFFIX,music.163.com,real-ip",
        "DOMAIN-SUFFIX,126.net,real-ip",
        "DOMAIN-SUFFIX,pool.ntp.org,real-ip",
        // 兜底：其余域名继续使用 fake-ip
        "MATCH,fake-ip",
    ],
    "nameserver": [
        "https://dns.google/dns-query",
        "https://cloudflare-dns.com/dns-query",
    ],
    "direct-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query",
    ],
    "proxy-server-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query",
    ],
    "nameserver-policy": {
        "geosite:private,cn": [
            "https://dns.alidns.com/dns-query",
            "https://doh.pub/dns-query",
        ],
    },
};

// ====== Sniffer 配置 ======
const SNIFFER_CONFIG = {
    "enable": true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": true,
    "sniff": {
        "HTTP": {
            "ports": [80, "8080-8880"],
            "override-destination": true,
        },
        "TLS": {
            "ports": [443, 8443],
        },
        "QUIC": {
            "ports": [443, 8443],
        },
    },
    "skip-domain": [
        "+.push.apple.com",
        "+.home.mi.com",
    ],
};

// ====== VPN 内网直连规则（规则集不覆盖的部分）======
const DIRECT_RULES = [
    // Tailscale CGNAT 网段（节点间 P2P 通信）
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
];

// ====== 规则集提供者 ======
function mrsProvider(url, behavior, proxy = "") {
    const provider = { type: "http", behavior, format: "mrs", interval: 86400, url };
    if (proxy) provider.proxy = proxy;
    return provider;
}

function buildRuleProviders(ruleProviderProxy, mediaMode = "balanced") {
    const providers = {
    // —— DustinWin（主力源）——
        "ads":             mrsProvider(`${DUSTIN}/ads.mrs`,          "domain", ruleProviderProxy),
        "private":         mrsProvider(`${DUSTIN}/private.mrs`,      "domain", ruleProviderProxy),
        "private-ip":      mrsProvider(`${DUSTIN}/privateip.mrs`,    "ipcidr", ruleProviderProxy),
        "ai":              mrsProvider(`${DUSTIN}/ai.mrs`,           "domain", ruleProviderProxy),
        "telegram-ip":     mrsProvider(`${DUSTIN}/telegramip.mrs`,   "ipcidr", ruleProviderProxy),
        "youtube":         mrsProvider(`${DUSTIN}/youtube.mrs`,      "domain", ruleProviderProxy),
        "netflix":         mrsProvider(`${DUSTIN}/netflix.mrs`,      "domain", ruleProviderProxy),
        "netflix-ip":      mrsProvider(`${DUSTIN}/netflixip.mrs`,    "ipcidr", ruleProviderProxy),
        "spotify":         mrsProvider(`${DUSTIN}/spotify.mrs`,      "domain", ruleProviderProxy),
        "tiktok":          mrsProvider(`${DUSTIN}/tiktok.mrs`,       "domain", ruleProviderProxy),
        "games-cn":        mrsProvider(`${DUSTIN}/games-cn.mrs`,     "domain", ruleProviderProxy),
        "games":           mrsProvider(`${DUSTIN}/games.mrs`,        "domain", ruleProviderProxy),
        "media":           mrsProvider(`${DUSTIN}/media.mrs`,        "domain", ruleProviderProxy),
        "media-ip":        mrsProvider(`${DUSTIN}/mediaip.mrs`,      "ipcidr", ruleProviderProxy),
        "networktest":     mrsProvider(`${DUSTIN}/networktest.mrs`,  "domain", ruleProviderProxy),
        "google-cn":       mrsProvider(`${DUSTIN}/google-cn.mrs`,    "domain", ruleProviderProxy),
        "microsoft-cn":    mrsProvider(`${DUSTIN}/microsoft-cn.mrs`, "domain", ruleProviderProxy),
        "apple-cn":        mrsProvider(`${DUSTIN}/apple-cn.mrs`,     "domain", ruleProviderProxy),
        "cn":              mrsProvider(`${DUSTIN}/cn.mrs`,           "domain", ruleProviderProxy),
        "cn-ip":           mrsProvider(`${DUSTIN}/cnip.mrs`,         "ipcidr", ruleProviderProxy),
        "proxy":           mrsProvider(`${DUSTIN}/proxy.mrs`,        "domain", ruleProviderProxy),
        // —— MetaCubeX（DustinWin 无单独拆分的服务）——
        "openai":          mrsProvider(`${META_LITE}/openai.mrs`,          "domain", ruleProviderProxy),
        "anthropic":       mrsProvider(`${META_FULL}/anthropic.mrs`,       "domain", ruleProviderProxy),
        "google-gemini":   mrsProvider(`${META_FULL}/google-gemini.mrs`,   "domain", ruleProviderProxy),
        "telegram":        mrsProvider(`${META_LITE}/telegram.mrs`,        "domain", ruleProviderProxy),
        "google":          mrsProvider(`${META_LITE}/google.mrs`,          "domain", ruleProviderProxy),
        "microsoft":       mrsProvider(`${META_LITE}/microsoft.mrs`,       "domain", ruleProviderProxy),
        "apple":           mrsProvider(`${META_LITE}/apple.mrs`,           "domain", ruleProviderProxy),
        "github":          mrsProvider(`${META_FULL}/github.mrs`,          "domain", ruleProviderProxy),
        "twitter":         mrsProvider(`${META_FULL}/twitter.mrs`,         "domain", ruleProviderProxy),
        "x":               mrsProvider(`${META_FULL}/x.mrs`,               "domain", ruleProviderProxy),
        "discord":         mrsProvider(`${META_FULL}/discord.mrs`,         "domain", ruleProviderProxy),
        "biliintl":        mrsProvider(`${META_FULL}/biliintl.mrs`,        "domain", ruleProviderProxy),
        "bilibili-not-cn": mrsProvider(`${META_FULL}/bilibili@!cn.mrs`,    "domain", ruleProviderProxy),
        "bahamut":         mrsProvider(`${META_FULL}/bahamut.mrs`,         "domain", ruleProviderProxy),
    };

    if (mediaMode === "full") {
        Object.assign(providers, {
            "disney":     mrsProvider(`${DUSTIN}/disney.mrs`,     "domain", ruleProviderProxy),
            "max":        mrsProvider(`${DUSTIN}/max.mrs`,        "domain", ruleProviderProxy),
            "primevideo": mrsProvider(`${DUSTIN}/primevideo.mrs`, "domain", ruleProviderProxy),
            "appletv":    mrsProvider(`${DUSTIN}/appletv.mrs`,    "domain", ruleProviderProxy),
        });
    }

    return providers;
}

// ====== 规则（从上到下匹配）======
function buildRules(mediaMode = "balanced") {
    const mediaRules = mediaMode === "full" ? [
        "RULE-SET,disney,Disney",
        "RULE-SET,max,Max",
        "RULE-SET,primevideo,PrimeVideo",
        "RULE-SET,appletv,AppleTV",
    ] : [];

    return [
    // 私有网络直连
    "RULE-SET,private,DIRECT",
    "RULE-SET,private-ip,DIRECT,no-resolve",
    // 广告拦截
    "RULE-SET,ads,广告拦截",
    // AI 服务（细分优先于通用）
    "RULE-SET,openai,OpenAI",
    "RULE-SET,anthropic,Anthropic",
    "RULE-SET,google-gemini,Gemini",
    "RULE-SET,ai,AI",
    // 通讯
    "RULE-SET,telegram,Telegram",
    "RULE-SET,telegram-ip,Telegram,no-resolve",
    "RULE-SET,github,GitHub",
    "RULE-SET,discord,Discord",
    "RULE-SET,twitter,Twitter",
    "RULE-SET,x,Twitter",
    // 测速
    "RULE-SET,networktest,Speedtest",
    // 游戏（国服直连优先于代理）
    "RULE-SET,games-cn,DIRECT",
    "RULE-SET,games,游戏",
    // 流媒体（细分优先于通用）
    "RULE-SET,youtube,YouTube",
    "RULE-SET,netflix,Netflix",
    "RULE-SET,netflix-ip,Netflix,no-resolve",
    "RULE-SET,spotify,Spotify",
    "RULE-SET,tiktok,TikTok",
    "RULE-SET,biliintl,Bilibili",
    "RULE-SET,bilibili-not-cn,Bilibili",
    "RULE-SET,bahamut,Bahamut",
    ...mediaRules,
    "RULE-SET,media,GlobalMedia",
    "RULE-SET,media-ip,GlobalMedia,no-resolve",
    // 科技巨头（国内直连优先于代理）
    "RULE-SET,google-cn,DIRECT",
    "RULE-SET,google,Google",
    "RULE-SET,microsoft-cn,DIRECT",
    "RULE-SET,microsoft,Microsoft",
    "RULE-SET,apple-cn,DIRECT",
    "RULE-SET,apple,Apple",
    // 国内流量
    "RULE-SET,cn,国内网站",
    "RULE-SET,cn-ip,国内网站,no-resolve",
    // 代理兜底
    "RULE-SET,proxy,Final",
    // 最终兜底
    "MATCH,Final",
    ];
}

// ====== 主函数 ======
function applyClientFingerprint(proxies, fingerprint = "chrome") {
    for (const proxy of proxies) {
        if (!proxy || !TLS_FINGERPRINT_TYPES.has(String(proxy.type || "").toLowerCase())) continue;
        if (proxy["client-fingerprint"]) continue;
        proxy["client-fingerprint"] = fingerprint;
    }
}

function isEnabled(value) {
    return ["true", "1", "yes", "on"].includes(String(value || "").toLowerCase());
}

function normalizeRegexPattern(raw, fallback) {
    const pattern = String(raw || fallback);
    try {
        new RegExp(pattern);
        return pattern;
    } catch (_) {
        return fallback;
    }
}

function detectLandingProxyNames(proxies, keyword) {
    const regex = new RegExp(keyword, "i");
    return proxies
        .map(proxy => proxy && proxy.name)
        .filter(name => name && regex.test(name));
}

function applyLandingDialer(proxies, landingNames) {
    const landingSet = new Set(landingNames);
    for (const proxy of proxies) {
        if (!proxy || !landingSet.has(proxy.name)) continue;
        proxy["dialer-proxy"] = LANDING_FRONT_GROUP;
    }
}

function readArgs() {
    return {
        ...(typeof $arguments !== "undefined" && $arguments ? $arguments : {}),
        ...(typeof $options !== "undefined" && $options ? $options : {}),
    };
}

function readString(args, name, fallback = "") {
    const value = args[name];
    if (value == null || value === "") return fallback;
    return String(value);
}

async function loadNodeSource(args) {
    const nodeSourceName = readString(args, "nodeSourceName", "");
    if (!nodeSourceName) return null;

    if (typeof produceArtifact !== "function") {
        throw new Error("nodeSourceName requires Sub-Store produceArtifact");
    }

    const nodeSourceType = readString(args, "nodeSourceType", "collection");
    return await produceArtifact({
        type: nodeSourceType,
        name: nodeSourceName,
        platform: "mihomo",
        produceType: "internal",
        produceOpts: {
            "delete-underscore-fields": true,
        },
    });
}

function applyConfigModes(config, args) {
    const coreMode = readString(args, "coreMode", "preserve");
    const dnsMode = readString(args, "dnsMode", "preserve");
    const snifferMode = readString(args, "snifferMode", "preserve");

    if (coreMode === "custom") {
        Object.assign(config, {
            "mode": "rule",
            "log-level": "info",
            "ipv6": false,
            "unified-delay": true,
            "tcp-concurrent": true,
            "find-process-mode": "strict",
        });
    }

    if (dnsMode === "custom") config["dns"] = clone(DNS_CONFIG);
    else if (dnsMode === "off") delete config["dns"];

    if (snifferMode === "custom") config["sniffer"] = clone(SNIFFER_CONFIG);
    else if (snifferMode === "off") delete config["sniffer"];
}

async function main(config) {
    config = config || {};
    const args = readArgs();
    const minCount       = toInt(args.minCount, 0);
    const groupType      = VALID_GROUP_TYPES.includes(args.groupType) ? args.groupType : "url-test";
    const overrideMap    = parseGroupOverride(args.groupOverride);
    const enableLanding  = isEnabled(args.enableLanding);
    const landingKeyword = normalizeRegexPattern(args.landingKeyword, DEFAULT_LANDING_KEYWORD);

    const sourceProxies = await loadNodeSource(args);
    const nodeMode = readString(args, "nodeMode", sourceProxies ? "replace" : "preserve");
    const proxies = sourceProxies && nodeMode === "replace" ? sourceProxies : (config.proxies || []);
    config.proxies = proxies;
    const landingNames = enableLanding ? detectLandingProxyNames(proxies, landingKeyword) : [];
    const landingSet = new Set(landingNames);
    const regionSourceProxies = landingNames.length > 0 ? proxies.filter(proxy => !landingSet.has(proxy.name)) : proxies;
    const { stats, unmatchedCount } = countByRegion(regionSourceProxies);
    const regionGroups = buildRegionGroups(stats, unmatchedCount, minCount, groupType, overrideMap, landingNames.length > 0 ? landingKeyword : "");
    const regionNames = regionGroups.map(g => g.name);

    applyClientFingerprint(proxies);
    if (landingNames.length > 0) applyLandingDialer(proxies, landingNames);
    applyConfigModes(config, args);

    const landingOption = landingNames.length > 0 ? [LANDING_GROUP] : [];
    const proxyFirst  = ["代理选择", ...landingOption, ...regionNames, "手动选择", "DIRECT"];
    const directFirst = ["DIRECT", "代理选择", ...landingOption, ...regionNames, "手动选择"];
    const landingGroups = landingNames.length > 0 ? [
        { name: LANDING_GROUP, type: "select", proxies: landingNames },
        { name: LANDING_FRONT_GROUP, type: "select", proxies: [...regionNames, "手动选择", "DIRECT"] },
    ] : [];

    const mediaMode = readString(args, "mediaMode", "balanced");
    const fullMediaGroups = mediaMode === "full" ? [
        { name: "Disney",      icon: `${EDC_FILTER}/Disney+.png`,   proxies: proxyFirst },
        { name: "Max",         icon: `${LOCAL_ICON}/max.png`,       proxies: proxyFirst },
        { name: "PrimeVideo",  icon: `${EDC_FILTER}/PrimeVideo.png`, proxies: proxyFirst },
        { name: "AppleTV",     icon: `${LOCAL_ICON}/appletv.png`,   proxies: proxyFirst },
    ] : [];

    // 服务分组
    const serviceGroups = [
        { name: "OpenAI",      icon: `${EDC_FILTER}/OpenAI.png`,    proxies: proxyFirst },
        { name: "Anthropic",   icon: `${LOCAL_ICON}/claude.png`,     proxies: proxyFirst },
        { name: "Gemini",      icon: `${LOCAL_ICON}/gemini.png`,     proxies: proxyFirst },
        { name: "AI",          icon: `${EDC_FILTER}/OpenAI.png`,    proxies: proxyFirst },
        { name: "Telegram",    icon: `${EDC_FILTER}/Telegram.png`,  proxies: proxyFirst },
        { name: "GitHub",      icon: `${LOCAL_ICON}/github.png`,    proxies: proxyFirst },
        { name: "Discord",     icon: `${LOCAL_ICON}/discord.png`,   proxies: proxyFirst },
        { name: "Twitter",     icon: `${EDC_FILTER}/Twitter.png`,   proxies: proxyFirst },
        { name: "YouTube",     icon: `${EDC_FILTER}/Youtube.png`,   proxies: proxyFirst },
        { name: "Google",      icon: `${EDC_FILTER}/Google.png`,    proxies: proxyFirst },
        { name: "Microsoft",   icon: `${EDC_FILTER}/Microsoft.png`, proxies: proxyFirst },
        { name: "Netflix",     icon: `${EDC_FILTER}/Netflix.png`,   proxies: proxyFirst },
        { name: "Spotify",     icon: `${EDC_FILTER}/Spotify.png`,   proxies: proxyFirst },
        { name: "TikTok",      icon: `${EDC_FILTER}/Tiktok.png`,    proxies: proxyFirst },
        { name: "Bilibili",    icon: `${EDC_FILTER}/Bilibili.png`,  proxies: proxyFirst },
        { name: "Bahamut",     icon: `${LOCAL_ICON}/bahamut.png`,   proxies: proxyFirst },
        ...fullMediaGroups,
        { name: "游戏",        icon: `${EDC_FILTER}/Game.png`,      proxies: proxyFirst },
        { name: "GlobalMedia", icon: `${EDC_FILTER}/GMedia.png`,    proxies: proxyFirst },
        { name: "Speedtest",   icon: `${EDC_FILTER}/Speedtest.png`, proxies: directFirst },
        { name: "Apple",       icon: `${EDC_FILTER}/Apple.png`,     proxies: directFirst },
        { name: "广告拦截",     icon: `${EDC_FILTER}/AdBlock.png`,   proxies: ["REJECT", "DIRECT"] },
        { name: "国内网站",     icon: `${EDC_FILTER}/Mainland.png`,  proxies: directFirst },
        { name: "Final",       icon: `${EDC_FILTER}/Final.png`,     proxies: proxyFirst },
    ].map(s => ({ type: "select", ...s }));

    if (readString(args, "groupsMode", "custom") === "custom") {
        // proxy-groups
        config["proxy-groups"] = [
            // 顶层
            { name: "代理选择", type: "select", icon: `${EDC_FILTER}/Proxy.png`, proxies: [...landingOption, ...regionNames, "手动选择", "DIRECT"] },
            // 节点分组
            { name: "手动选择", type: "select", icon: `${ORZ3}/Static.png`, "include-all": true },
            ...regionGroups,
            ...landingGroups,
            // 服务分组
            ...serviceGroups,
        ];
    }

    if (readString(args, "rulesMode", "custom") === "custom") {
        // rule-providers & rules
        const ruleProviderProxy = readString(args, "ruleProviderProxy", "代理选择");
        config["rule-providers"] = buildRuleProviders(ruleProviderProxy, mediaMode);
        config["rules"] = [...DIRECT_RULES, ...buildRules(mediaMode)];
    }

    return config;
}

function getYamlUtils() {
    const proxyYaml = typeof ProxyUtils !== "undefined" && ProxyUtils && ProxyUtils.yaml ? ProxyUtils.yaml : null;
    const globalYaml = typeof yaml !== "undefined" ? yaml : null;
    const utils = proxyYaml || globalYaml;
    if (!utils || typeof utils.safeLoad !== "function" || typeof utils.safeDump !== "function") {
        throw new Error("Sub-Store YAML utilities are unavailable");
    }
    return utils;
}

async function operator(input) {
    if (!input || typeof input !== "object" || !("$content" in input)) return input;

    const content = input.$content == null ? "" : String(input.$content);
    if (!content.trim()) return input;

    const yamlUtils = getYamlUtils();
    const config = yamlUtils.safeLoad(content) || {};
    input.$content = yamlUtils.safeDump(await main(config));
    return input;
}
