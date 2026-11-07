// Zips a built extension for the stores: node scripts/pack.ts <dist folder> <zip file>
// Uses bsdtar (Windows' own tar.exe, or macOS tar), which writes a real zip for a .zip name.
// GNU tar (Git Bash's tar.exe, most Linux) writes a tar file instead, so the result is checked.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("Usage: node scripts/pack.ts <dist folder> <zip file>");
  process.exit(1);
}
const FILES = ["manifest.json", "popup.html", "popup.css", "popup.js", "lib.js", "icons", "fonts", "src"];
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "bsdtar";

rmSync(out, { force: true });
execFileSync(tar, ["-a", "-c", "-f", out, "-C", dir, ...FILES], { stdio: "inherit" });
if (readFileSync(out).subarray(0, 2).toString("latin1") !== "PK") {
  rmSync(out);
  console.error(`${tar} didn't write a zip. Install bsdtar (libarchive) and try again.`);
  process.exit(1);
}
console.log(`wrote ${out}`);
