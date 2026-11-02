// Bundles src/ into dist/. AUTH_BASE defaults to the production auth function; override with an
// https origin, e.g.  AUTH_BASE=https://func-xyz.azurewebsites.net npm run build
// (http://localhost:<port> and http://127.0.0.1:<port> are also allowed, for the local auth function).
// --dev: standalone mock mode. Watches and serves dist-dev over plain http on :3000 with the Azure DevOps SDK and
// the fetch calls replaced by src/dev (see README); nothing from src/dev is reachable from the production entry point.
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const DEV = process.argv.includes("--dev");
const AUTH_BASE = process.env.AUTH_BASE || (DEV ? "http://localhost:7071" : "https://func-tnit-ghrepoview.azurewebsites.net");
const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(AUTH_BASE);
if (!URL.canParse(AUTH_BASE) || (!isLocalHttp && new URL(AUTH_BASE).protocol !== "https:") || new URL(AUTH_BASE).origin !== AUTH_BASE) {
  throw new Error(`AUTH_BASE must be an https:// origin (or http://localhost:<port>), with no path or trailing slash, got: ${AUTH_BASE}`);
}

const OUT = DEV ? "dist-dev" : "dist"; // separate folders so a production build never clobbers the dev server
rmSync(OUT, { recursive: true, force: true }); // chunk names are hashed, so don't let old ones pile up in the package
mkdirSync(OUT, { recursive: true });
copyFileSync("hub.html", `${OUT}/hub.html`);
if (DEV) copyFileSync("hub.html", `${OUT}/index.html`); // so plain http://localhost:3000 works
const options = {
  // monaco is also an entry point so its JS and CSS get stable names (monaco.js, monaco.css): esbuild does not link a lazy chunk's CSS into the page, so Browser.tsx adds the monaco.css <link> itself.
  entryPoints: { index: DEV ? "src/dev/main.tsx" : "src/index.tsx", monaco: "src/monacoChunk.ts" },
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  // splitting needs ESM: Monaco is loaded by a dynamic import() into its own chunk (hub.html loads index.js as a module).
  format: "esm",
  splitting: true,
  outdir: OUT,
  // Dev swaps the SDK at the module boundary, so app code has no mock branches.
  alias: DEV ? { "azure-devops-extension-sdk": "./src/dev/mockSdk.ts" } : {},
  minify: !DEV,
  target: "es2020",
  metafile: true,
  loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
  define: { __AUTH_BASE__: JSON.stringify(AUTH_BASE), "process.env.NODE_ENV": DEV ? '"development"' : '"production"' },
  logLevel: "info",
};
// Each lazy language chunk gets a copy of the editor CSS that nothing references; keep only the two linked stylesheets.
const pruneCss = (metafile) => {
  for (const f of Object.keys(metafile.outputs)) if (f.endsWith(".css") && !/^dist(-dev)?\/(index|monaco)\.css$/.test(f)) { rmSync(f); delete metafile.outputs[f]; }
};

if (DEV) {
  const ctx = await context({ ...options, plugins: [{ name: "prune-css", setup: (b) => b.onEnd((r) => r.metafile && pruneCss(r.metafile)) }] });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: OUT, port: 3000, host: "localhost" });
  console.log(`AUTH_BASE = ${AUTH_BASE}
Mock mode: http://localhost:${port}/hub.html (edit, then refresh)`);
} else {
  const result = await build(options);
  pruneCss(result.metafile);
  for (const [file, o] of Object.entries(result.metafile.outputs)) console.log(`${(o.bytes / 1024).toFixed(0).padStart(7)} KB  ${file}`);
  console.log(`AUTH_BASE = ${AUTH_BASE}`);
}
