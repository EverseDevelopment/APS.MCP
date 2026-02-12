/**
 * Update the version field in manifest.json.
 * Called by semantic-release via @semantic-release/exec.
 *
 * Usage: node scripts/update-manifest-version.mjs <version>
 */

import fs from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/update-manifest-version.mjs <version>");
  process.exit(1);
}

const file = "manifest.json";
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.version = version;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Updated ${file} version to ${version}`);
