#!/usr/bin/env node
/**
 * Build local policy icons used by rule/mihomo/overwrite.js.
 *
 * Why this script exists:
 * - Quantumult X / Mihomo policy icons are safest as small PNG assets.
 * - Some upstream icons are SVG-only; rendering them with macOS thumbnail tools
 *   can produce poor edges and inconsistent padding.
 * - This script uses sharp in a temporary workspace, so the repository does not
 *   need a package.json or committed node_modules.
 *
 * Usage:
 *   node scripts/build-icons.mjs
 *
 * Output:
 *   icon/github.png
 *   icon/discord.png
 *   icon/appletv.png
 *   icon/max.png
 *   icon/gemini.png
 *   icon/claude.png
 *   icon/bahamut.png
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "icon");
mkdirSync(outDir, { recursive: true });

const workDir = mkdtempSync(join(tmpdir(), "rule-script-icons-"));

const worker = String.raw`
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = process.argv[2];
await fs.mkdir(outDir, { recursive: true });

const generatedIcons = [
  { name: "github", slug: "simple-icons:github", bg: "#181717", scale: 82 },
  { name: "discord", slug: "simple-icons:discord", bg: "#5865F2", scale: 82 },
  { name: "appletv", slug: "simple-icons:appletv", bg: "#111111", scale: 84 },
  { name: "max", slug: "simple-icons:max", bg: "#002BE7", scale: 78 },
  { name: "gemini", slug: "simple-icons:googlegemini", bg: "#1A73E8", scale: 82 },
  { name: "claude", slug: "simple-icons:claude", bg: "#D97757", scale: 82 },
];

function tileBackground(color) {
  return Buffer.from(
    '<svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="144" height="144" rx="30" fill="' + color + '"/>' +
    '</svg>'
  );
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return Buffer.from(await response.arrayBuffer());
}

for (const icon of generatedIcons) {
  const svg = await fetchBuffer(
    "https://api.iconify.design/" + icon.slug + ".svg?color=%23ffffff"
  );
  const logo = await sharp(svg)
    .resize(icon.scale, icon.scale, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(logo).metadata();

  await sharp(tileBackground(icon.bg))
    .composite([
      {
        input: logo,
        left: Math.round((144 - meta.width) / 2),
        top: Math.round((144 - meta.height) / 2),
      },
    ])
    .png()
    .toFile(path.join(outDir, icon.name + ".png"));
}

// No good official/Iconify Bahamut SVG was available when this was added.
// Qure's color asset is already a 144x144 RGBA PNG and visually matches policy icons.
const bahamut = await fetchBuffer(
  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/icon/qure/color/Bahamut.png"
);
await sharp(bahamut).resize(144, 144).png().toFile(path.join(outDir, "bahamut.png"));
`;

writeFileSync(join(workDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
writeFileSync(join(workDir, "build-icons-worker.mjs"), worker);

execFileSync("npm", ["install", "sharp", "--silent"], { cwd: workDir, stdio: "inherit" });
execFileSync("node", ["build-icons-worker.mjs", outDir], { cwd: workDir, stdio: "inherit" });

console.log(`Built icons in ${outDir}`);
