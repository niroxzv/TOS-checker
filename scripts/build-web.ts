// Builds the web app and the extension, with no dependencies:
// Node's built-in stripTypeScriptTypes removes the types, and `.ts` imports become `.js`.
//
//   dist/app/        <- app/        and dist/app/src/        <- src/  (minus the Node-only cli.ts)
//   dist/extension/  <- extension/  and dist/extension/src/  <- src/  (minus cli.ts and the web-only AI mode)
//   dist/firefox/    <- dist/extension/ with Firefox's additions merged into manifest.json
//
// Files directly inside app/ or extension/ import "../src/x.ts"; in dist that becomes "./src/x.js".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const NODE_ONLY = new Set(["cli.ts"]);
/** AI mode talks to a local model server; only the web app has it. */
const WEB_ONLY = new Set(["ai"]);
const FIREFOX_MANIFEST = "manifest.firefox.json";

for (const target of ["app", "extension"]) {
  const from = join(root, target);
  if (!existsSync(from)) continue;
  const out = join(root, "dist", target);
  rmSync(out, { recursive: true, force: true });
  copyTree(from, out, true, new Set([FIREFOX_MANIFEST]));
  copyTree(join(root, "src"), join(out, "src"), false, target === "extension" ? WEB_ONLY : new Set());
  console.log(`built dist/${target}`);
}
buildFirefox();

/** The same files as dist/extension, plus Firefox's add-on id and settings in manifest.json. */
function buildFirefox() {
  const out = join(root, "dist", "firefox");
  rmSync(out, { recursive: true, force: true });
  cpSync(join(root, "dist", "extension"), out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8"));
  const extra = JSON.parse(readFileSync(join(root, "extension", FIREFOX_MANIFEST), "utf8"));
  const merged = { ...manifest, ...extra, icons: { ...manifest.icons, ...extra.icons } };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(merged, null, 2) + "\n");
  console.log("built dist/firefox");
}

function copyTree(from: string, to: string, isTargetRoot: boolean, skip: Set<string>) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (skip.has(name)) continue;
    const path = join(from, name);
    if (statSync(path).isDirectory()) {
      copyTree(path, join(to, name), false, new Set());
    } else if (!name.endsWith(".ts")) {
      cpSync(path, join(to, name));
    } else if (isTargetRoot || !NODE_ONLY.has(name)) {
      const js = rewriteImports(stripTypeScriptTypes(readFileSync(path, "utf8")), isTargetRoot);
      // A file of types only (src/types.ts) strips down to comments and blank lines, and nothing imports it
      // at run time, so it isn't shipped: add-on reviewers ask for no unused files.
      if (!js.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").trim()) continue;
      writeFileSync(join(to, name.replace(/\.ts$/, ".js")), js);
    }
  }
}

function rewriteImports(code: string, isTargetRoot: boolean): string {
  return code.replace(/((?:from|import)\s*\(?\s*)(["'])(\.\.?\/[^"']*?)\.ts\2/g, (_m, pre, q, spec) => {
    if (isTargetRoot) spec = spec.replace(/^\.\.\/src\//, "./src/");
    return `${pre}${q}${spec}.js${q}`;
  });
}
