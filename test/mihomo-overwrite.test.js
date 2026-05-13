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
  assert.strictEqual(output["rule-providers"].github.proxy, "代理选择");
  assert.strictEqual(output["rule-providers"]["google-gemini"].proxy, "代理选择");
  assert.ok(output.rules.indexOf("RULE-SET,google-gemini,Gemini") < output.rules.indexOf("RULE-SET,google,Google"));
  assert.ok(output.rules.includes("RULE-SET,github,GitHub"));
  assert.ok(output.rules.includes("RULE-SET,discord,Discord"));
  assert.ok(output.rules.includes("RULE-SET,biliintl,Bilibili"));
  assert.ok(output.rules.includes("RULE-SET,bilibili-not-cn,Bilibili"));
  assert.ok(!output.rules.includes("RULE-SET,bilibili,Bilibili"));
}

async function testCanPreserveGroupsAndRules() {
  const existingGroups = [{ name: "Official Group", type: "select", proxies: ["DIRECT"] }];
  const existingProviders = { official: { type: "http", url: "https://official.example/rule.mrs" } };
  const existingRules = ["MATCH,Official"];
  const context = loadScript({
    optionsValue: {
      nodeSourceName: "Mix-Landing",
      groupsMode: "preserve",
      rulesMode: "preserve",
    },
    producedProxies: [{ name: "Mix HK 01", type: "ss" }],
  });

  const output = await context.__main({
    "proxy-groups": existingGroups,
    "rule-providers": existingProviders,
    rules: existingRules,
  });

  assert.strictEqual(output["proxy-groups"], existingGroups);
  assert.strictEqual(output["rule-providers"], existingProviders);
  assert.strictEqual(output.rules, existingRules);
}

async function testFullMediaModeAddsOptionalMedia() {
  const context = loadScript({
    optionsValue: { nodeSourceName: "Mix-Landing", mediaMode: "full" },
    producedProxies: [{ name: "Mix HK 01", type: "ss" }],
  });

  const output = await context.__main({});

  assert.ok(output.rules.includes("RULE-SET,disney,Disney"));
  assert.ok(output.rules.includes("RULE-SET,max,Max"));
  assert.ok(output.rules.includes("RULE-SET,primevideo,PrimeVideo"));
  assert.ok(output.rules.includes("RULE-SET,appletv,AppleTV"));
  assert.strictEqual(output["rule-providers"].disney.proxy, "代理选择");
  assert.strictEqual(output["rule-providers"].max.proxy, "代理选择");
}

async function main() {
  await testPreservesDnsAndReplacesNodes();
  await testCanPreserveGroupsAndRules();
  await testFullMediaModeAddsOptionalMedia();
  console.log("mihomo overwrite tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
