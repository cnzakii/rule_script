const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const script = fs.readFileSync(path.join(__dirname, "..", "rule", "loon", "overwrite.js"), "utf8");

async function render(official, disableDoH = false) {
  let requests = 0;
  const output = await vm.runInNewContext(`(async () => { ${script}\nreturn $content; })()`, {
    URLSearchParams,
    $content: "[Remote Proxy]\nAmyTelecom = https://example.com/nodes,enabled=true",
    $arguments: { officialUrl: "https://example.com/official", disableDoH },
    $substore: { http: { get: async () => { requests++; return { body: official }; } } },
  });
  assert.strictEqual(requests, 1);
  return output;
}

async function main() {
  const general = "[General]\ndns-server=119.29.29.29\ndoh-server=https://example.com/dns-query";
  const hosts = "node-a.example.com = entry-a.example.com\nnode-b.example.com = entry-b.example.com";
  const withoutHost = await render(general);
  const withHost = await render(`${general}\n[Host]\n# upstream mappings\n${hosts}\n[Proxy]\n`.replace(/\n/g, "\r\n"));
  assert.ok(withHost.includes(`[Host]\n${hosts}\n\n`));
  assert.strictEqual(withHost.replace(`[Host]\n${hosts}\n\n`, ""), withoutHost);
  assert.ok(!withoutHost.includes("[Host]"));
  const noDoH = await render(`${general}\n[Host]\n${hosts}`, true);
  assert.ok(!noDoH.includes("doh-server="));
  assert.ok(noDoH.includes(`[Host]\n${hosts}`));
  await assert.rejects(render("[Host]\n" + hosts), /did not return a Loon profile/);
  console.log("loon overwrite tests passed");
}

main().catch(error => { console.error(error); process.exit(1); });
