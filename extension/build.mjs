// Bundles src/ into dist/. AUTH_BASE defaults to the production auth function; override with an
// https origin, e.g.  AUTH_BASE=https://func-xyz.azurewebsites.net npm run build
// (http://localhost:<port> and http://127.0.0.1:<port> are also allowed, for the local auth function).
// --dev: standalone mock mode. Watches and serves dist-dev over plain http on :3000 with the Azure DevOps SDK and
// the fetch calls replaced by src/dev (see README); nothing from src/dev is reachable from the production entry point.
import { build, context } from "esbuild";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import http from "node:http";

const DEV = process.argv.includes("--dev");
const AUTH_BASE = process.env.AUTH_BASE || (DEV ? "http://localhost:7071" : "https://func-tnit-ghrepoview.azurewebsites.net");
const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(AUTH_BASE);
if (!URL.canParse(AUTH_BASE) || (!isLocalHttp && new URL(AUTH_BASE).protocol !== "https:") || new URL(AUTH_BASE).origin !== AUTH_BASE) {
  throw new Error(`AUTH_BASE must be an https:// origin (or http://localhost:<port>), with no path or trailing slash, got: ${AUTH_BASE}`);
}

// Live mode (dev only): LIVE=1 with GH_SANDBOX_TOKEN. The token stays in this Node process: the page sends api.github.com requests to
// this server's /__gh/… proxy (src/dev/ghProxy.ts), which adds it, guards each request and follows log/artifact redirects.
const LIVE = process.env.LIVE === "1";
if (LIVE && !DEV) throw new Error("LIVE=1 is for the dev harness only; a production build never carries a token.");
if (LIVE && !process.env.GH_SANDBOX_TOKEN) throw new Error("LIVE=1 needs GH_SANDBOX_TOKEN in the environment.");
// Behind an HTTPS proxy (cloud sessions), Node's fetch must use it too, and Node reads NODE_USE_ENV_PROXY only at start-up: re-run under it.
if (LIVE && (process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
  await new Promise(() => {}); // the child does the work
}

const OUT = DEV ? process.env.DEV_OUT || "dist-dev" : "dist"; // DEV_OUT and PORT let a second dev server run beside the first (e.g. DEV_OUT=dist-dev/b PORT=3001); separate folders so a production build never clobbers the dev server
rmSync(OUT, { recursive: true, force: true }); // chunk names are hashed, so don't let old ones pile up in the package
mkdirSync(OUT, { recursive: true });
copyFileSync("hub.html", `${OUT}/hub.html`);
copyFileSync("breadcrumb.html", `${OUT}/breadcrumb.html`);
if (DEV) copyFileSync("hub.html", `${OUT}/index.html`); // so plain http://localhost:3000 works
const options = {
  // editor.worker is Monaco's base worker (diff computation), loaded as a module worker from monacoChunk.ts; it sits beside monaco.js. monaco is also an entry point so its JS and CSS get stable names (monaco.js, monaco.css): esbuild does not link a lazy chunk's CSS into the page, so Browser.tsx adds the monaco.css <link> itself.
  entryPoints: { index: DEV ? "src/dev/main.tsx" : "src/index.tsx", monaco: "src/monacoChunk.ts", "editor.worker": "monaco-editor/editor/editor.worker.js", breadcrumb: "src/breadcrumb.ts" },
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
  define: { __AUTH_BASE__: JSON.stringify(AUTH_BASE), "process.env.NODE_ENV": DEV ? '"development"' : '"production"', ...(DEV && { __LIVE__: JSON.stringify(LIVE) }) },
  logLevel: "info",
};
if (!DEV && Object.keys(options.define).some((k) => /LIVE/.test(k))) throw new Error("The production build must not define live-mode values.");
// Each lazy language chunk gets a copy of the editor CSS that nothing references; keep only the two linked stylesheets.
const pruneCss = (metafile) => {
  for (const f of Object.keys(metafile.outputs)) if (f.endsWith(".css") && !/^dist.*\/(index|monaco)\.css$/.test(f)) { rmSync(f); delete metafile.outputs[f]; }
};

if (DEV) {
  const ctx = await context({ ...options, plugins: [{ name: "prune-css", setup: (b) => b.onEnd((r) => r.metafile && pruneCss(r.metafile)) }] });
  await ctx.watch();
  // esbuild serves the bundle on a private port; a small Node server in front passes everything through, except /__gh/… in live mode.
  const inner = await ctx.serve({ servedir: OUT, host: "127.0.0.1" }); // esbuild picks a free port
  const ghProxy = LIVE ? await loadGhProxy() : undefined;
  const front = http.createServer((req, res) => {
    if (req.url === "/__gh" || req.url?.startsWith("/__gh/")) {
      if (!ghProxy) { res.writeHead(404).end("/__gh is live mode only (LIVE=1)"); return; }
      serveProxied(ghProxy, req, res);
      return;
    }
    const up = http.request({ host: "127.0.0.1", port: inner.port, method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  const port = Number(process.env.PORT) || 3000;
  await new Promise((ok, fail) => front.once("error", fail).listen(port, "localhost", ok));
  console.log(`AUTH_BASE = ${AUTH_BASE}
${LIVE ? `LIVE mode: api.github.com is real through /__gh, limited to TrueNorthIT/gh-repos-sandbox${process.env.NODE_USE_ENV_PROXY === "1" ? " (via HTTPS_PROXY)" : ""}\n` : ""}Mock mode: http://localhost:${port}/hub.html (edit, then refresh)`);
} else {
  const result = await build(options);
  pruneCss(result.metafile);
  for (const [file, o] of Object.entries(result.metafile.outputs)) console.log(`${(o.bytes / 1024).toFixed(0).padStart(7)} KB  ${file}`);
  console.log(`AUTH_BASE = ${AUTH_BASE}`);
}

/** Bundles src/dev/ghProxy.ts for Node (it imports the TypeScript guard) and binds it to the token, Node's fetch and the console. */
async function loadGhProxy() {
  const r = await build({ entryPoints: ["src/dev/ghProxy.ts"], bundle: true, platform: "node", format: "esm", target: "node20", write: false, logLevel: "silent" });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  return mod.createGhProxy({ token: process.env.GH_SANDBOX_TOKEN, fetch: globalThis.fetch, log: (m) => console.error(m) });
}

async function serveProxied(handle, req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle({ method: req.method ?? "GET", url: req.url ?? "", headers: req.headers, body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const c of r.body) res.write(c);
    res.end();
  } catch (e) {
    console.error(`[gh proxy] ${req.method} ${req.url?.split("?")[0]}: ${e?.message ?? e}`);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "The dev server could not reach GitHub." }));
  }
}
