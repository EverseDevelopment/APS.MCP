/**
 * Pack the MCP server into an .mcpb bundle (ZIP with manifest + server + node_modules).
 * Run from repo root: node scripts/pack-mcpb.mjs
 * Prerequisite: npm run build
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".mcpb-build");
const outFile = path.join(root, "acc-mcp.mcpb");

// Clean and create bundle dir
if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(path.join(buildDir, "server"), { recursive: true });

// Copy manifest
fs.copyFileSync(path.join(root, "manifest.json"), path.join(buildDir, "manifest.json"));

// Copy server entry (dist -> server/)
const distDir = path.join(root, "dist");
for (const name of ["index.js", "aps-auth.js", "aps-issues-helpers.js", "aps-dm-helpers.js"]) {
  const src = path.join(distDir, name);
  if (!fs.existsSync(src)) throw new Error(`Build first: missing ${src}`);
  fs.copyFileSync(src, path.join(buildDir, "server", name));
}

// Bundle package.json (dependencies only for production install)
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const bundlePkg = {
  name: pkg.name,
  version: pkg.version,
  type: "module",
  dependencies: pkg.dependencies || {},
};
fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify(bundlePkg, null, 2));

// Install production deps in bundle dir
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(npm, ["install", "--omit=dev"], {
  cwd: buildDir,
  stdio: "inherit",
  shell: true,
});
if (install.status !== 0) {
  console.error("npm install in bundle failed");
  process.exit(1);
}

// Create .mcpb (ZIP) using system command
const buildDirAbs = path.resolve(buildDir);
const outFileAbs = path.resolve(outFile);
if (process.platform === "win32") {
  // PowerShell: compress contents of buildDir into outFile
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${buildDirAbs}\\*" -DestinationPath "${outFileAbs}" -Force`,
    ],
    { stdio: "inherit" }
  );
  if (ps.status !== 0) process.exit(1);
} else {
  const zip = spawnSync("zip", ["-r", outFileAbs, "."], {
    cwd: buildDir,
    stdio: "inherit",
  });
  if (zip.status !== 0) process.exit(1);
}

// Cleanup
fs.rmSync(buildDir, { recursive: true });

console.log(`Created ${outFile}`);
