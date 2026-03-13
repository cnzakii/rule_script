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

// ====== 规则集来源（blackmatrix7）======
const RULES_BASE = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash";

const ruleProviders = {
    "Advertising":  { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/AdvertisingLite/AdvertisingLite_Classical_No_Resolve.yaml`, path: "./ruleset/Advertising.yaml" },
    "OpenAI":       { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/OpenAI/OpenAI_No_Resolve.yaml`,                             path: "./ruleset/OpenAI.yaml" },
    "Claude":       { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Claude/Claude_No_Resolve.yaml`,                             path: "./ruleset/Claude.yaml" },
    "Telegram":     { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Telegram/Telegram_No_Resolve.yaml`,                         path: "./ruleset/Telegram.yaml" },
    "YouTube":      { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/YouTube/YouTube_No_Resolve.yaml`,                           path: "./ruleset/YouTube.yaml" },
    "Google":       { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Google/Google_No_Resolve.yaml`,                             path: "./ruleset/Google.yaml" },
    "Microsoft":    { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Microsoft/Microsoft_No_Resolve.yaml`,                       path: "./ruleset/Microsoft.yaml" },
    "Netflix":      { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Netflix/Netflix_Classical_No_Resolve.yaml`,                  path: "./ruleset/Netflix.yaml" },
    "Spotify":      { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Spotify/Spotify_No_Resolve.yaml`,                           path: "./ruleset/Spotify.yaml" },
    "TikTok":       { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/TikTok/TikTok_No_Resolve.yaml`,                             path: "./ruleset/TikTok.yaml" },
    "Steam":        { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Steam/Steam_No_Resolve.yaml`,                               path: "./ruleset/Steam.yaml" },
    "Game":         { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Game/Game_No_Resolve.yaml`,                                 path: "./ruleset/Game.yaml" },
    "GlobalMedia":  { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/GlobalMedia/GlobalMedia_Classical_No_Resolve.yaml`,          path: "./ruleset/GlobalMedia.yaml" },
    "Speedtest":    { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Speedtest/Speedtest_No_Resolve.yaml`,                       path: "./ruleset/Speedtest.yaml" },
    "Apple":        { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Apple/Apple_Classical_No_Resolve.yaml`,                      path: "./ruleset/Apple.yaml" },
    "Mail":         { type: "http", behavior: "classical", format: "yaml", interval: 86400, url: `${RULES_BASE}/Mail/Mail_No_Resolve.yaml`,                                path: "./ruleset/Mail.yaml" },
};

// ====== 规则（参考 clash.yaml 顺序，从上到下匹配）======
const rules = [
    // 广告拦截（最高优先）
    "RULE-SET,Advertising,广告拦截",
    // AI 服务（细分优先于通用）
    "RULE-SET,OpenAI,OpenAI",
    "RULE-SET,Claude,Anthropic",
    "GEOSITE,category-ai-!cn,AI",
    // 通讯
    "RULE-SET,Telegram,Telegram",
    // 测速
    "RULE-SET,Speedtest,Speedtest",
    // 游戏（Steam 优先于通用 Game）
    "RULE-SET,Steam,Steam",
    "RULE-SET,Game,Game",
    // 流媒体（细分优先于通用 GlobalMedia）
    "RULE-SET,YouTube,YouTube",
    "RULE-SET,Netflix,Netflix",
    "RULE-SET,Spotify,Spotify",
    "RULE-SET,TikTok,TikTok",
    "RULE-SET,GlobalMedia,GlobalMedia",
    // 邮件（SMTP/IMAP 不走代理）
    "RULE-SET,Mail,DIRECT",
    // 科技巨头
    "RULE-SET,Google,Google",
    "RULE-SET,Microsoft,Microsoft",
    "RULE-SET,Apple,Apple",
    // 国内流量
    "GEOSITE,cn,国内网站",
    "GEOIP,cn,国内网站,no-resolve",
    // 兜底
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

    // 全局配置
    Object.assign(config, {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": true,
        "mode": "rule",
        "log-level": "info",
        "external-controller": "127.0.0.1:9090",
    });

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
        { name: "Steam",       icon: `${ORZ3}/Steam.png`,      proxies: proxyFirst },
        { name: "Game",        icon: `${ORZ3}/GAME.png`,       proxies: proxyFirst },
        { name: "GlobalMedia", icon: `${ORZ3}/Streaming.png`,  proxies: proxyFirst },
        { name: "Speedtest",   icon: `${ORZ3}/Speedtest.png`,  proxies: proxyFirst },
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
    config["rules"] = rules;

    return config;
}