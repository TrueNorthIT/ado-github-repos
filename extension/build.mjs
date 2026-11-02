// Bundles src/ into dist/. AUTH_BASE defaults to the production auth function; override with an
// https origin, e.g.  AUTH_BASE=https://func-xyz.azurewebsites.net npm run build
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const AUTH_BASE = process.env.AUTH_BASE || "https://func-tnit-ghrepoview.azurewebsites.net";
if (!URL.canParse(AUTH_BASE) || new URL(AUTH_BASE).protocol !== "https:" || new URL(AUTH_BASE).origin !== AUTH_BASE) {
  throw new Error(`AUTH_BASE must be an https:// origin (no path or trailing slash), got: ${AUTH_BASE}`);
}

mkdirSync("dist", { recursive: true });
copyFileSync("hub.html", "dist/hub.html");
await build({
  entryPoints: { index: "src/index.tsx" },
  bundle: true,
  outdir: "dist",
  minify: true,
  target: "es2019",
  loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
  define: { __AUTH_BASE__: JSON.stringify(AUTH_BASE), "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
console.log(`AUTH_BASE = ${AUTH_BASE}`);
