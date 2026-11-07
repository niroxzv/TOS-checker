// Builds the browser versions of the desktop UI and the extension, with no dependencies:
// Node's built-in stripTypeScriptTypes removes the types, and `.ts` imports become `.js`.
//
//   dist/app/        <- app/        and dist/app/src/        <- src/  (minus the Node-only cli.ts)
//   dist/extension/  <- extension/  and dist/extension/src/  <- src/
//
// Files directly inside app/ or extension/ import "../src/x.ts"; in dist that becomes "./src/x.js".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const NODE_ONLY = new Set(["cli.ts"]);

for (const target of ["app", "extension"]) {
  const from = join(root, target);
  if (!existsSync(from)) continue;
  const out = join(root, "dist", target);
  rmSync(out, { recursive: true, force: true });
  copyTree(from, out, true);
  copyTree(join(root, "src"), join(out, "src"), false);
  console.log(`built dist/${target}`);
}

function copyTree(from: string, to: string, isTargetRoot: boolean) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const path = join(from, name);
    if (statSync(path).isDirectory()) {
      copyTree(path, join(to, name), false);
    } else if (!name.endsWith(".ts")) {
      cpSync(path, join(to, name));
    } else if (isTargetRoot || !NODE_ONLY.has(name)) {
      const js = rewriteImports(stripTypeScriptTypes(readFileSync(path, "utf8")), isTargetRoot);
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
