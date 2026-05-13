# Mihomo Sub-Store OpenClash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `rule/mihomo/overwrite.js` so OpenClash uses the provider official profile for DNS/base runtime settings, uses `Mix-Landing` as the final node source, and uses repository-defined groups/rules/icons.

**Architecture:** Keep the existing single-file Sub-Store script. Add small helper functions for argument parsing, mode handling, Sub-Store node loading, rule-provider creation, and icon mapping. Default behavior preserves official DNS/sniffer/core fields and replaces only nodes, groups, rule-providers, and rules.

**Tech Stack:** JavaScript for Sub-Store/Mihomo profile scripts, Sub-Store `produceArtifact`, Mihomo YAML semantics, Node.js built-in `assert`/`vm` for local validation.

---

## File Structure

- Modify: `rule/mihomo/overwrite.js`
  - Owns Sub-Store Mihomo profile transformation.
  - Adds async `main(config)`.
  - Adds runtime switches and Mix-Landing node replacement.
  - Updates rule providers, rules, groups, and icons.
- Create: `test/mihomo-overwrite.test.js`
  - Runs the script in a local VM.
  - Stubs `$arguments`, `$options`, and `produceArtifact`.
  - Verifies DNS preservation, node replacement, generated rules, and icon URLs.
- Optional create: `icon/github.png`, `icon/discord.png`, `icon/bahamut.png`, `icon/appletv.png`, `icon/max.png`, `icon/x.png`
  - Only create/download after choosing source images.
  - Must be PNG 108x108 or 144x144 RGBA.

---

### Task 1: Add Local Test Harness

**Files:**
- Create: `test/mihomo-overwrite.test.js`

- [ ] **Step 1: Create a failing test harness**

Use `apply_patch` to add:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript({ argumentsValue = {}, optionsValue = {}, producedProxies = [] } = {}) {
  const script = fs.readFileSync(path.join(__dirname, "..", "rule", "mihomo", "overwrite.js"), "utf8");
  const context = {
    console,
    $arguments: argumentsValue,
    $options: optionsValue,
    produceArtifact: async (request) => {
      context.produceArtifactRequests.push(request);
      return producedProxies;
    },
    produceArtifactRequests: [],
  };
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.__main = main;`, context);
  return context;
}

async function testPreservesDnsAndReplacesNodes() {
  const producedProxies = [
    { name: "Mix HK 01", type: "ss" },
  ];
  const context = loadScript({
    optionsValue: { nodeSourceName: "Mix-Landing" },
    producedProxies,
  });
  const input = {
    dns: { enable: true, preserved: ["official-dns-placeholder"] },
    sniffer: { enable: true },
    proxies: [{ name: "Official HK 01", type: "ss" }],
  };

  const output = await context.__main(input);

  assert.deepStrictEqual(output.dns, { enable: true, preserved: ["official-dns-placeholder"] });
  assert.deepStrictEqual(output.sniffer, { enable: true });
  assert.deepStrictEqual(output.proxies, producedProxies);
  assert.strictEqual(context.produceArtifactRequests[0].type, "collection");
  assert.strictEqual(context.produceArtifactRequests[0].name, "Mix-Landing");
  assert.strictEqual(context.produceArtifactRequests[0].platform, "mihomo");
  assert.strictEqual(context.produceArtifactRequests[0].produceType, "internal");
}

async function main() {
  await testPreservesDnsAndReplacesNodes();
  console.log("mihomo overwrite tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify current failure**

Run: `node test/mihomo-overwrite.test.js`

Expected: FAIL because current `main` is not async, does not call `produceArtifact`, and overwrites `dns`.

- [ ] **Step 3: Commit test harness**

Run:

```bash
git add test/mihomo-overwrite.test.js
git commit -m "test: add mihomo overwrite harness"
```

If commits are not desired in this session, skip the commit and keep the file staged status visible in `git status --short`.

---

### Task 2: Add Argument Parsing And Node Source Replacement

**Files:**
- Modify: `rule/mihomo/overwrite.js`

- [ ] **Step 1: Add helper functions before `main`**

Insert before `function main(config)`:

```js
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
```

- [ ] **Step 2: Change `main` to async and use helper args**

Replace:

```js
function main(config) {
    const args = typeof $arguments !== "undefined" ? $arguments : {};
```

with:

```js
async function main(config) {
    config = config || {};
    const args = readArgs();
```

- [ ] **Step 3: Replace proxy source selection**

Replace:

```js
    const proxies = config.proxies || [];
```

with:

```js
    const sourceProxies = await loadNodeSource(args);
    const nodeMode = readString(args, "nodeMode", sourceProxies ? "replace" : "preserve");
    const proxies = sourceProxies && nodeMode === "replace" ? sourceProxies : (config.proxies || []);
    config.proxies = proxies;
```

- [ ] **Step 4: Run test**

Run: `node test/mihomo-overwrite.test.js`

Expected: still FAIL because DNS is still overwritten in Task 3.

---

### Task 3: Add DNS, Sniffer, And Core Mode Switches

**Files:**
- Modify: `rule/mihomo/overwrite.js`

- [ ] **Step 1: Add mode helper**

Insert before `main`:

```js
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
```

- [ ] **Step 2: Replace unconditional core/DNS/sniffer writes**

Delete the current `Object.assign(config, ...)`, `config["dns"] = clone(DNS_CONFIG);`, and `config["sniffer"] = clone(SNIFFER_CONFIG);` blocks.

Insert after landing dialer setup:

```js
    applyConfigModes(config, args);
```

- [ ] **Step 3: Run test**

Run: `node test/mihomo-overwrite.test.js`

Expected: PASS for DNS preservation and node replacement.

---

### Task 4: Update Rule Providers

**Files:**
- Modify: `rule/mihomo/overwrite.js`

- [ ] **Step 1: Update provider helper**

Replace:

```js
function mrsProvider(url, behavior) {
    return { type: "http", behavior, format: "mrs", interval: 86400, url };
}
```

with:

```js
function mrsProvider(url, behavior, proxy = "") {
    const provider = { type: "http", behavior, format: "mrs", interval: 86400, url };
    if (proxy) provider.proxy = proxy;
    return provider;
}
```

- [ ] **Step 2: Convert static providers to builder**

Replace `const ruleProviders = { ... };` with:

```js
function buildRuleProviders(ruleProviderProxy) {
    return {
        "ads":                mrsProvider(`${DUSTIN}/ads.mrs`, "domain", ruleProviderProxy),
        "private":            mrsProvider(`${DUSTIN}/private.mrs`, "domain", ruleProviderProxy),
        "private-ip":         mrsProvider(`${DUSTIN}/privateip.mrs`, "ipcidr", ruleProviderProxy),
        "ai":                 mrsProvider(`${DUSTIN}/ai.mrs`, "domain", ruleProviderProxy),
        "telegram-ip":        mrsProvider(`${DUSTIN}/telegramip.mrs`, "ipcidr", ruleProviderProxy),
        "youtube":            mrsProvider(`${DUSTIN}/youtube.mrs`, "domain", ruleProviderProxy),
        "netflix":            mrsProvider(`${DUSTIN}/netflix.mrs`, "domain", ruleProviderProxy),
        "netflix-ip":         mrsProvider(`${DUSTIN}/netflixip.mrs`, "ipcidr", ruleProviderProxy),
        "spotify":            mrsProvider(`${DUSTIN}/spotify.mrs`, "domain", ruleProviderProxy),
        "tiktok":             mrsProvider(`${DUSTIN}/tiktok.mrs`, "domain", ruleProviderProxy),
        "games-cn":           mrsProvider(`${DUSTIN}/games-cn.mrs`, "domain", ruleProviderProxy),
        "games":              mrsProvider(`${DUSTIN}/games.mrs`, "domain", ruleProviderProxy),
        "media":              mrsProvider(`${DUSTIN}/media.mrs`, "domain", ruleProviderProxy),
        "media-ip":           mrsProvider(`${DUSTIN}/mediaip.mrs`, "ipcidr", ruleProviderProxy),
        "networktest":        mrsProvider(`${DUSTIN}/networktest.mrs`, "domain", ruleProviderProxy),
        "google-cn":          mrsProvider(`${DUSTIN}/google-cn.mrs`, "domain", ruleProviderProxy),
        "microsoft-cn":       mrsProvider(`${DUSTIN}/microsoft-cn.mrs`, "domain", ruleProviderProxy),
        "apple-cn":           mrsProvider(`${DUSTIN}/apple-cn.mrs`, "domain", ruleProviderProxy),
        "cn":                 mrsProvider(`${DUSTIN}/cn.mrs`, "domain", ruleProviderProxy),
        "cn-ip":              mrsProvider(`${DUSTIN}/cnip.mrs`, "ipcidr", ruleProviderProxy),
        "proxy":              mrsProvider(`${DUSTIN}/proxy.mrs`, "domain", ruleProviderProxy),
        "openai":             mrsProvider(`${META_LITE}/openai.mrs`, "domain", ruleProviderProxy),
        "anthropic":          mrsProvider(`${META_FULL}/anthropic.mrs`, "domain", ruleProviderProxy),
        "google-gemini":      mrsProvider(`${META_FULL}/google-gemini.mrs`, "domain", ruleProviderProxy),
        "telegram":           mrsProvider(`${META_LITE}/telegram.mrs`, "domain", ruleProviderProxy),
        "google":             mrsProvider(`${META_LITE}/google.mrs`, "domain", ruleProviderProxy),
        "microsoft":          mrsProvider(`${META_LITE}/microsoft.mrs`, "domain", ruleProviderProxy),
        "apple":              mrsProvider(`${META_LITE}/apple.mrs`, "domain", ruleProviderProxy),
        "github":             mrsProvider(`${META_FULL}/github.mrs`, "domain", ruleProviderProxy),
        "twitter":            mrsProvider(`${META_FULL}/twitter.mrs`, "domain", ruleProviderProxy),
        "x":                  mrsProvider(`${META_FULL}/x.mrs`, "domain", ruleProviderProxy),
        "discord":            mrsProvider(`${META_FULL}/discord.mrs`, "domain", ruleProviderProxy),
        "biliintl":           mrsProvider(`${META_FULL}/biliintl.mrs`, "domain", ruleProviderProxy),
        "bilibili-not-cn":    mrsProvider(`${META_FULL}/bilibili@!cn.mrs`, "domain", ruleProviderProxy),
        "bahamut":            mrsProvider(`${META_FULL}/bahamut.mrs`, "domain", ruleProviderProxy),
    };
}
```

- [ ] **Step 3: Use dynamic providers in main**

Replace:

```js
    config["rule-providers"] = ruleProviders;
```

with:

```js
    const ruleProviderProxy = readString(args, "ruleProviderProxy", "代理选择");
    config["rule-providers"] = buildRuleProviders(ruleProviderProxy);
```

- [ ] **Step 4: Extend test for rule provider proxy**

Add this assertion to `testPreservesDnsAndReplacesNodes`:

```js
  assert.strictEqual(output["rule-providers"].github.proxy, "代理选择");
  assert.strictEqual(output["rule-providers"]["google-gemini"].proxy, "代理选择");
```

- [ ] **Step 5: Run test**

Run: `node test/mihomo-overwrite.test.js`

Expected: PASS.

---

### Task 5: Update Rules And Groups

**Files:**
- Modify: `rule/mihomo/overwrite.js`
- Modify: `test/mihomo-overwrite.test.js`

- [ ] **Step 1: Add service groups**

Add these service groups near existing AI/social/media groups:

```js
        { name: "GitHub",      icon: `${LOCAL_ICON}/github.png`,     proxies: proxyFirst },
        { name: "Twitter",     icon: `${EDC_FILTER}/Twitter.png`,    proxies: proxyFirst },
        { name: "Discord",     icon: `${LOCAL_ICON}/discord.png`,    proxies: proxyFirst },
        { name: "Bilibili",    icon: `${EDC_FILTER}/Bilibili.png`,   proxies: proxyFirst },
        { name: "Bahamut",     icon: `${LOCAL_ICON}/bahamut.png`,    proxies: proxyFirst },
```

Also add at the top:

```js
const LOCAL_ICON = "https://raw.githubusercontent.com/cnzakii/rule_script/main/icon";
```

Replace hard-coded Claude/Gemini icon URLs with `${LOCAL_ICON}/claude.png` and `${LOCAL_ICON}/gemini.png`.

- [ ] **Step 2: Add routing rules**

Update `rules` so the relevant section is:

```js
    "RULE-SET,openai,OpenAI",
    "RULE-SET,anthropic,Anthropic",
    "RULE-SET,google-gemini,Gemini",
    "RULE-SET,ai,AI",
    "RULE-SET,telegram,Telegram",
    "RULE-SET,telegram-ip,Telegram,no-resolve",
    "RULE-SET,github,GitHub",
    "RULE-SET,discord,Discord",
    "RULE-SET,twitter,Twitter",
    "RULE-SET,x,Twitter",
    "RULE-SET,networktest,Speedtest",
```

In media rules, add before generic media:

```js
    "RULE-SET,biliintl,Bilibili",
    "RULE-SET,bilibili-not-cn,Bilibili",
    "RULE-SET,bahamut,Bahamut",
```

Do not add a rule that sends all `bilibili` to proxy.

- [ ] **Step 3: Extend tests**

Add:

```js
  assert.ok(output.rules.indexOf("RULE-SET,google-gemini,Gemini") < output.rules.indexOf("RULE-SET,google,Google"));
  assert.ok(output.rules.includes("RULE-SET,github,GitHub"));
  assert.ok(output.rules.includes("RULE-SET,discord,Discord"));
  assert.ok(output.rules.includes("RULE-SET,biliintl,Bilibili"));
  assert.ok(output.rules.includes("RULE-SET,bilibili-not-cn,Bilibili"));
  assert.ok(!output.rules.includes("RULE-SET,bilibili,Bilibili"));
```

- [ ] **Step 4: Run test**

Run: `node test/mihomo-overwrite.test.js`

Expected: PASS.

---

### Task 6: Add Or Verify Local Icons

**Files:**
- Create if approved: `icon/github.png`, `icon/discord.png`, `icon/bahamut.png`

- [ ] **Step 1: Inspect existing local icons**

Run:

```bash
file icon/*.png
```

Expected: existing local icons are `PNG image data, 108 x 108` or `144 x 144`, `8-bit/color RGBA, non-interlaced`.

- [ ] **Step 2: Add only required local icons**

Required for default groups:

```text
icon/github.png
icon/discord.png
icon/bahamut.png
```

Do not add `appletv.png`, `max.png`, or `x.png` until `mediaMode=full` or an `X`-named group is implemented.

- [ ] **Step 3: Validate icon compatibility**

Run:

```bash
file icon/*.png
```

Expected: all local icons are `PNG image data, 108 x 108` or `144 x 144`, `8-bit/color RGBA, non-interlaced`.

---

### Task 7: Final Validation

**Files:**
- Modify only if tests reveal issues: `rule/mihomo/overwrite.js`, `test/mihomo-overwrite.test.js`

- [ ] **Step 1: Run local tests**

Run:

```bash
node test/mihomo-overwrite.test.js
```

Expected:

```text
mihomo overwrite tests passed
```

- [ ] **Step 2: Inspect script for accidental DNS overwrite**

Run:

```bash
rg -n 'config\\["dns"\\]|config\\["sniffer"\\]|DNS_CONFIG|SNIFFER_CONFIG' rule/mihomo/overwrite.js
```

Expected: `config["dns"]` and `config["sniffer"]` writes appear only inside `applyConfigModes`.

- [ ] **Step 3: Inspect rule-provider URLs**

Run:

```bash
rg -n 'github|discord|google-gemini|biliintl|bilibili-not-cn|ruleProviderProxy' rule/mihomo/overwrite.js
```

Expected: providers and rules exist for all listed items.

- [ ] **Step 4: Check git diff**

Run:

```bash
git diff -- rule/mihomo/overwrite.js test/mihomo-overwrite.test.js docs/superpowers
```

Expected: diff matches this plan and does not include secrets or downloaded subscription content.
