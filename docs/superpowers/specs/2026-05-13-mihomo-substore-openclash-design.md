# Mihomo Sub-Store OpenClash Override Design

## Goal

Build a Sub-Store Mihomo profile script for OpenClash on OpenWrt that uses the provider official profile as the base configuration while keeping user-owned node, group, and rule policy generation in this repository.

The official profile is the source of DNS and router-sensitive runtime settings. The Sub-Store collection is the source of final proxy nodes. This script is the source of policy groups, rule providers, and rules.

## Verified Context

- Current generated Sub-Store output contains DNS from this script, not from the provider official profile.
- Current script forcibly writes `dns` and `sniffer`.
- The provider announcement requires official subscription behavior and no DNS override.
- OpenClash runs on OpenWrt, so DNS behavior can involve dnsmasq, OpenClash DNS hijack, and mihomo DNS. DNS and sniffer defaults should be conservative.
- Mihomo docs state that `respect-rules` requires `proxy-server-nameserver`, and strongly discourage using `respect-rules` with `prefer-h3`.
- Sub-Store `mihomoProfile` does not accept a remote official Mihomo YAML file as its base source. In the current UI it accepts `subscription`, `collection`, or `none`.
- The current deployed Sub-Store file named `Mihomo` is a normal remote `file` with a `Script Operator`. For this path Sub-Store passes `$content` to the script, but does not automatically call `main(config)`.

## Configuration Sources

1. Official Mihomo profile
   - Preserve by default: `dns`, `sniffer`, `tun`, ports, controller, profile, and other base runtime settings.
   - Do not preserve by default: `proxies`, `proxy-groups`, `rule-providers`, `rules`.
   - Loaded by Sub-Store as a normal remote file, not as `mihomoProfile`.

2. Sub-Store collection
   - Default node source: `collection/Mix-Landing`.
   - The script loads it with `produceArtifact`.
   - These nodes fully replace official `proxies`.

3. Repository script
   - Exposes `operator(input)` for normal Sub-Store file processing. It parses `input.$content` as YAML, calls `main(config)`, and writes YAML back to `input.$content`.
   - Keeps `main(config)` as the core transformation so `mihomoProfile` remains compatible if used later.
   - Generates proxy groups.
   - Generates rule providers.
   - Generates route rules.
   - Applies node-level tweaks such as client fingerprint and optional landing dialer.

## Script Parameters

- `nodeSourceType`: `collection` or `subscription`; default `collection`.
- `nodeSourceName`: Sub-Store source name; default empty. Recommended value: `Mix-Landing`.
- `nodeMode`: `replace` or `preserve`; default `replace` when `nodeSourceName` is set.
- `dnsMode`: `preserve`, `off`, or `custom`; default `preserve`.
- `snifferMode`: `preserve`, `off`, or `custom`; default `preserve`.
- `coreMode`: `preserve` or `custom`; default `preserve`.
- `groupsMode`: `custom` or `preserve`; default `custom`.
- `rulesMode`: `custom` or `preserve`; default `custom`.
- `ruleProviderProxy`: proxy used to update remote rule providers; default `代理选择`.
- Existing group parameters remain supported: `minCount`, `groupType`, `groupOverride`, `enableLanding`, `landingKeyword`.

Arguments should be read from both `$arguments` and `$options`, with `$options` overriding `$arguments`.

## Default Behavior

Recommended OpenClash behavior:

```text
dnsMode=preserve
snifferMode=preserve
coreMode=preserve
nodeSourceType=collection
nodeSourceName=Mix-Landing
nodeMode=replace
groupsMode=custom
rulesMode=custom
ruleProviderProxy=代理选择
```

This produces:

```text
official DNS + official base runtime settings + Mix-Landing nodes + repository groups/rules
```

## Sub-Store Entry Point

The recommended Sub-Store setup is:

```text
File type: normal file
File source: provider official full Mihomo profile URL
Processor: Script Operator using this repository script
Node source: collection/Mix-Landing via script parameters
```

Do not switch this file to `mihomoProfile` for the current deployment. `mihomoProfile` can call `main(config)` automatically, but it cannot use the provider official full Mihomo profile URL as the base YAML source in the current Sub-Store UI.

For normal file processing the script must provide:

```js
async function operator(input) {
  const config = ProxyUtils.yaml.safeLoad(input.$content);
  input.$content = ProxyUtils.yaml.safeDump(await main(config));
  return input;
}
```

The actual implementation should keep the parser checks defensive and return the original input unchanged when no `$content` exists, so the script remains safe in non-file contexts.

## Rule Source Strategy

Use DustinWin for broad, curated rule categories:

- `ads`
- `private`, `private-ip`
- `ai`
- `games-cn`, `games`
- `youtube`, `netflix`, `netflix-ip`
- `spotify`, `tiktok`
- `media`, `media-ip`
- `networktest`
- `google-cn`, `microsoft-cn`, `apple-cn`
- `cn`, `cn-ip`
- `proxy`

Use MetaCubeX where DustinWin does not provide a specific set:

- `openai`
- `anthropic`
- `google-gemini`
- `telegram`
- `google`
- `microsoft`
- `apple`
- `github`
- `twitter` / `x`
- `discord`
- `bahamut`
- `biliintl`
- `bilibili@!cn`

Do not route all Bilibili traffic through a proxy by default. Domestic Bilibili should fall through to CN/DIRECT; `biliintl` and `bilibili@!cn` can use a dedicated Bilibili policy group.

## Rule Improvements

Default additions:

- Add `GitHub` group and rules.
- Add `Discord` group and rules.
- Add `Twitter` group and rules using both `twitter` and `x` providers when available.
- Add `Gemini` rule using `google-gemini`, placed before general `google`.
- Add `Bilibili` group only for `biliintl` and `bilibili@!cn`.

Optional media expansion:

- `Disney`
- `Max`
- `PrimeVideo`
- `AppleTV`
- `Bahamut`

These are controlled by `mediaMode`. Default `mediaMode=balanced` excludes these groups. `mediaMode=full` includes them. They must not change domestic Bilibili behavior.

## Icon Strategy

Use `https://raw.githubusercontent.com/erdongchanyo/icon/main/Policy-Filter` as the primary icon set.

Verified properties for sampled EDC icons:

- PNG
- 108 x 108
- RGBA
- non-interlaced

This is compatible with common Quantumult X policy icon expectations. Local fallback icons may use either 108 x 108 or 144 x 144 PNG assets.

Use EDC icons where available:

- `Proxy.png`
- `Final.png`
- `AdBlock.png`
- `Mainland.png`
- `OpenAI.png`
- `Telegram.png`
- `Youtube.png`
- `Google.png`
- `Microsoft.png`
- `Netflix.png`
- `Spotify.png`
- `Tiktok.png`
- `Game.png`
- `GMedia.png`
- `Speedtest.png`
- `Apple.png`
- `Twitter.png`
- `Bilibili.png`
- `Disney+.png`
- `HBO.png`
- `PrimeVideo.png`

Keep local icons for missing EDC items:

- `icon/gemini.png`
- `icon/claude.png`

Add these local icons before enabling the matching groups:

- `icon/github.png`
- `icon/discord.png`
- `icon/bahamut.png`
- `icon/appletv.png`
- `icon/max.png`
- `icon/x.png`

Local icons must be PNG, 108x108 or 144x144, RGBA, transparent where possible, and use lowercase ASCII filenames.

## Validation

After implementation:

- Generate or download a Sub-Store output profile.
- Confirm official `dns.nameserver` is preserved when using the official profile as base.
- Confirm `proxies` are from `Mix-Landing`.
- Confirm `proxy-groups`, `rule-providers`, and `rules` are generated by the script.
- Confirm no script DNS is emitted unless `dnsMode=custom`.
- Confirm rule providers include `proxy: 代理选择` by default.
- Confirm Bilibili domestic rules are not forced into proxy.
- Confirm all referenced icon URLs return PNG files.
