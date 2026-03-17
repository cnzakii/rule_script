/**
 * Sub-Store Mihomo 订阅转换脚本
 *
 * 支持参数：
 * - minCount:     节点数量低于该值的地区归入"其他地区"（默认 0）
 * - groupType:    地区分组默认策略 select / url-test / load-balance（默认 url-test）
 * - groupOverride: 覆盖特定分组类型，格式 "香港:select,美国:load-balance"
 */

const ORZ3 = "https://gcore.jsdelivr.net/gh/Orz-3/mini@master/Color";
const VALID_GROUP_TYPES = ["select", "url-test", "load-balance"];
const TEST_URL = "https://cp.cloudflare.com/generate_204";

// ====== 规则集来源 ======
const DUSTIN = "https://raw.githubusercontent.com/DustinWin/ruleset_geodata/mihomo-ruleset";
const META_LITE = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo-lite/geosite";
const META_FULL = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite";

// ====== 地区元数据 ======
const regions = [
    { name: "香港",     pattern: "香港|港|HK|Hong Kong|HongKong|🇭🇰",                icon: `${ORZ3}/HK.png` },
    { name: "台湾",     pattern: "台|新北|彰化|TW|Taiwan|🇹🇼|🇨🇳",                    icon: `${ORZ3}/CN.png` },
    { name: "新加坡",   pattern: "新加坡|坡|狮城|SG|Singapore|🇸🇬",                    icon: `${ORZ3}/SG.png` },
    { name: "日本",     pattern: "日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵", icon: `${ORZ3}/JP.png` },
    { name: "韩国",     pattern: "KR|Korea|KOR|首尔|韩|韓|🇰🇷",                        icon: `${ORZ3}/KR.png` },
    { name: "美国",     pattern: "美国|美|US|United States|🇺🇸",                        icon: `${ORZ3}/US.png` },
    { name: "加拿大",   pattern: "加拿大|Canada|CA|🇨🇦",                                icon: `${ORZ3}/CA.png` },
    { name: "英国",     pattern: "英国|United Kingdom|UK|伦敦|London|🇬🇧",              icon: `${ORZ3}/UK.png` },
    { name: "法国",     pattern: "法国|法|FR|France|🇫🇷",                               icon: `${ORZ3}/FR.png` },
    { name: "德国",     pattern: "德国|德|DE|Germany|🇩🇪",                              icon: `${ORZ3}/DE.png` },
    { name: "荷兰",     pattern: "荷兰|NL|Netherlands|🇳🇱",                             icon: `${ORZ3}/NL.png` },
    { name: "澳大利亚", pattern: "澳洲|澳大利亚|AU|Australia|🇦🇺",                     icon: `${ORZ3}/AU.png` },
    { name: "俄罗斯",   pattern: "俄罗斯|俄|RU|Russia|🇷🇺",                            icon: `${ORZ3}/RU.png` },
    { name: "土耳其",   pattern: "土耳其|TR|Turkey|Türkiye|🇹🇷",                        icon: `${ORZ3}/TR.png` },
];

// ====== 工具函数 ======
const toInt = (v, d = 0) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };

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
    return regions.reduce((acc, r) => {
        const regex = new RegExp(r.pattern);
        const count = proxies.filter(p => regex.test(p.name || "")).length;
        if (count > 0) acc.push({ ...r, count });
        return acc;
    }, []);
}

/** 创建单个地区/筛选分组，type 由 override 或 defaultType 决定 */
function makeGroup(name, filterOrExclude, defaultType, overrideMap, isExclude, icon) {
    const type = overrideMap[name] || defaultType;
    const g = { name, type, "include-all": true };
    if (icon) g.icon = icon;
    if (isExclude) g["exclude-filter"] = filterOrExclude;
    else g.filter = filterOrExclude;
    if (type === "url-test") Object.assign(g, urlTestOpts());
    return g;
}

/** 构建全部地区 + 特殊筛选分组 */
function buildRegionGroups(proxies, stats, minCount, defaultType, overrideMap) {
    const groups = [];
    const keptPatterns = [];

    for (const r of stats) {
        if (r.count >= minCount) {
            groups.push(makeGroup(r.name, r.pattern, defaultType, overrideMap, false, r.icon));
            keptPatterns.push(r.pattern);
        }
    }

    // 其他地区
    if (keptPatterns.length > 0) {
        const keptRe = new RegExp(keptPatterns.join("|"));
        if (proxies.some(p => !keptRe.test(p.name || ""))) {
            groups.push(makeGroup("其他地区", keptPatterns.join("|"), defaultType, overrideMap, true, `${ORZ3}/UN.png`));
        }
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
    "fake-ip-filter": [
        // Tailscale
        "+.tailscale.com",
        "+.tailscale.io",
        "+.ts.net",
        // ZeroTier
        "+.zerotier.com",
        "+.zerotierstatic.com",
        // WireGuard
        "+.wireguard.com",
        // STUN
        "+.stun.*.*",
        "+.stun.*.*.*",
        "+.stun.*.*.*.*",
        "+.stun.*.*.*.*.*",
        "stun.*.*",
        "stun.*.*.*",
        // NTP
        "+.ntp.org",
        "time.*.com",
        "time.*.gov",
        "time.*.apple.com",
        "time*.cloud.tencent.com",
        "ntp.*.com",
        // 连通性检测
        "+.msftconnecttest.com",
        "+.msftncsi.com",
        "localhost.ptlogin2.qq.com",
        "localhost.sec.qq.com",
        "+.captive.apple.com",
        "connectivitycheck.gstatic.com",
        "detectportal.firefox.com",
        // 局域网/mDNS
        "+.local",
        "+.lan",
        "+.home.arpa",
        // 游戏主机
        "+.srv.nintendo.net",
        "*.n.n.srv.nintendo.net",
        "+.stun.playstation.net",
        "xbox.*.microsoft.com",
        "+.xboxlive.com",
        "+.battlenet.com.cn",
        "+.battlenet.com",
        // 其他
        "+.music.163.com",
        "+.126.net",
        "+.pool.ntp.org",
        "+.localhost",
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
function mrsProvider(url, behavior) {
    return { type: "http", behavior, format: "mrs", interval: 86400, url };
}

const ruleProviders = {
    // —— DustinWin（主力源）——
    "ads":            mrsProvider(`${DUSTIN}/ads.mrs`,           "domain"),
    "private":        mrsProvider(`${DUSTIN}/private.mrs`,       "domain"),
    "private-ip":     mrsProvider(`${DUSTIN}/privateip.mrs`,     "ipcidr"),
    "ai":             mrsProvider(`${DUSTIN}/ai.mrs`,            "domain"),
    "telegram-ip":    mrsProvider(`${DUSTIN}/telegramip.mrs`,    "ipcidr"),
    "youtube":        mrsProvider(`${DUSTIN}/youtube.mrs`,       "domain"),
    "netflix":        mrsProvider(`${DUSTIN}/netflix.mrs`,       "domain"),
    "netflix-ip":     mrsProvider(`${DUSTIN}/netflixip.mrs`,     "ipcidr"),
    "spotify":        mrsProvider(`${DUSTIN}/spotify.mrs`,       "domain"),
    "tiktok":         mrsProvider(`${DUSTIN}/tiktok.mrs`,        "domain"),
    "games-cn":       mrsProvider(`${DUSTIN}/games-cn.mrs`,      "domain"),
    "games":          mrsProvider(`${DUSTIN}/games.mrs`,         "domain"),
    "media":          mrsProvider(`${DUSTIN}/media.mrs`,         "domain"),
    "media-ip":       mrsProvider(`${DUSTIN}/mediaip.mrs`,       "ipcidr"),
    "networktest":    mrsProvider(`${DUSTIN}/networktest.mrs`,   "domain"),
    "google-cn":      mrsProvider(`${DUSTIN}/google-cn.mrs`,     "domain"),
    "microsoft-cn":   mrsProvider(`${DUSTIN}/microsoft-cn.mrs`,  "domain"),
    "apple-cn":       mrsProvider(`${DUSTIN}/apple-cn.mrs`,      "domain"),
    "cn":             mrsProvider(`${DUSTIN}/cn.mrs`,            "domain"),
    "cn-ip":          mrsProvider(`${DUSTIN}/cnip.mrs`,          "ipcidr"),
    "proxy":          mrsProvider(`${DUSTIN}/proxy.mrs`,         "domain"),
    // —— MetaCubeX（DustinWin 无单独拆分的服务）——
    "openai":         mrsProvider(`${META_LITE}/openai.mrs`,     "domain"),
    "anthropic":      mrsProvider(`${META_FULL}/anthropic.mrs`,  "domain"),
    "telegram":       mrsProvider(`${META_LITE}/telegram.mrs`,   "domain"),
    "google":         mrsProvider(`${META_LITE}/google.mrs`,     "domain"),
    "microsoft":      mrsProvider(`${META_LITE}/microsoft.mrs`,  "domain"),
    "apple":          mrsProvider(`${META_LITE}/apple.mrs`,      "domain"),
};

// ====== 规则（从上到下匹配）======
const rules = [
    // 私有网络直连
    "RULE-SET,private,DIRECT",
    "RULE-SET,private-ip,DIRECT,no-resolve",
    // 广告拦截
    "RULE-SET,ads,广告拦截",
    // AI 服务（细分优先于通用）
    "RULE-SET,openai,OpenAI",
    "RULE-SET,anthropic,Anthropic",
    "RULE-SET,ai,AI",
    // 通讯
    "RULE-SET,telegram,Telegram",
    "RULE-SET,telegram-ip,Telegram,no-resolve",
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

// ====== 主函数 ======
function main(config) {
    const args = typeof $arguments !== "undefined" ? $arguments : {};
    const minCount    = toInt(args.minCount, 0);
    const groupType   = VALID_GROUP_TYPES.includes(args.groupType) ? args.groupType : "url-test";
    const overrideMap = parseGroupOverride(args.groupOverride);

    const proxies = config.proxies || [];
    const regionGroups = buildRegionGroups(proxies, countByRegion(proxies), minCount, groupType, overrideMap);
    const regionNames = regionGroups.map(g => g.name);

    // 内核通用优化（不含端口/外部控制器等客户端特定设置）
    Object.assign(config, {
        "mode": "rule",
        "log-level": "info",
        "ipv6": false,
        "unified-delay": true,
        "tcp-concurrent": true,
        "find-process-mode": "strict",
        "global-client-fingerprint": "chrome",
    });

    // DNS
    config["dns"] = DNS_CONFIG;

    // Sniffer
    config["sniffer"] = SNIFFER_CONFIG;

    const proxyFirst  = ["代理选择", ...regionNames, "手动选择", "DIRECT"];
    const directFirst = ["DIRECT", "代理选择", ...regionNames, "手动选择"];

    // 服务分组
    const serviceGroups = [
        { name: "OpenAI",      icon: "https://raw.githubusercontent.com/cnzakii/rule_script/main/icon/openai.png",  proxies: proxyFirst },
        { name: "Anthropic",   icon: "https://raw.githubusercontent.com/cnzakii/rule_script/main/icon/claude.png",  proxies: proxyFirst },
        { name: "AI",          icon: `${ORZ3}/OpenAI.png`,     proxies: proxyFirst },
        { name: "Telegram",    icon: `${ORZ3}/Telegram.png`,   proxies: proxyFirst },
        { name: "YouTube",     icon: `${ORZ3}/YouTube.png`,    proxies: proxyFirst },
        { name: "Google",      icon: `${ORZ3}/Google.png`,     proxies: proxyFirst },
        { name: "Microsoft",   icon: `${ORZ3}/Microsoft.png`,  proxies: proxyFirst },
        { name: "Netflix",     icon: `${ORZ3}/Netflix.png`,    proxies: proxyFirst },
        { name: "Spotify",     icon: `${ORZ3}/Spotify.png`,    proxies: proxyFirst },
        { name: "TikTok",      icon: `${ORZ3}/TikTok.png`,    proxies: proxyFirst },
        { name: "游戏",        icon: `${ORZ3}/GAME.png`,       proxies: proxyFirst },
        { name: "GlobalMedia", icon: `${ORZ3}/Streaming.png`,  proxies: proxyFirst },
        { name: "Speedtest",   icon: `${ORZ3}/Speedtest.png`,  proxies: directFirst },
        { name: "Apple",       icon: `${ORZ3}/Apple.png`,      proxies: directFirst },
        { name: "广告拦截",     icon: `${ORZ3}/Adblock.png`,    proxies: ["REJECT", "DIRECT"] },
        { name: "国内网站",     icon: `${ORZ3}/China.png`,      proxies: directFirst },
        { name: "Final",       icon: `${ORZ3}/Final.png`,      proxies: proxyFirst },
    ].map(s => ({ type: "select", ...s }));

    // proxy-groups
    config["proxy-groups"] = [
        // 顶层
        { name: "代理选择", type: "select", icon: `${ORZ3}/Roundrobin.png`, proxies: [...regionNames, "手动选择", "DIRECT"] },
        // 节点分组
        { name: "手动选择", type: "select", icon: `${ORZ3}/Static.png`, "include-all": true },
        ...regionGroups,
        // 服务分组
        ...serviceGroups,
    ];

    // rule-providers & rules
    config["rule-providers"] = ruleProviders;
    config["rules"] = [...DIRECT_RULES, ...rules];

    return config;
}
