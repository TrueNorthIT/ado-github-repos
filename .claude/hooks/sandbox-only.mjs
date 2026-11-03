// PreToolUse hook (Bash): a second guard behind the live-mode repo guard. If a command uses the sandbox token (GH_SANDBOX_TOKEN or a
// ghu_ token) and also names a GitHub repository other than TrueNorthIT/gh-repos-sandbox, block it (exit 2, reason on stderr).
// Reads the hook JSON on stdin (tool_input.command). Run with node.
const SANDBOX = "truenorthit/gh-repos-sandbox";
let raw = "";
for await (const c of process.stdin) raw += c;
let cmd = "";
try { cmd = String(JSON.parse(raw).tool_input?.command ?? ""); } catch { process.exit(0); }
if (!/GH_SANDBOX_TOKEN|ghu_[A-Za-z0-9]/.test(cmd)) process.exit(0);

const found = new Set();
const add = (o, n) => found.add(`${o}/${n}`.replace(/\.git$/, "").toLowerCase());
for (const m of cmd.matchAll(/\/repos\/([^/\s"'`?]+)\/([^/\s"'`?]+)/g)) add(m[1], m[2]);
for (const m of cmd.matchAll(/(?<!api\.)github\.com[/:]([^/\s"'`]+)\/([^/\s"'`?#]+)/g)) add(m[1], m[2]);
for (const m of cmd.matchAll(/(?:^|\s)(?:-R|--repo)(?:\s+|=)["']?([^/\s"']+)\/([^\s"']+?)["']?(?=\s|$)/g)) add(m[1], m[2]);
for (const m of cmd.matchAll(/repo:["']?([^/\s"']+)\/([^\s"']+?)["']?(?=\s|$|&|")/g)) add(m[1], m[2]);

const other = [...found].filter((r) => r !== SANDBOX);
if (other.length) {
  console.error(`Blocked: this command uses the sandbox token but targets ${other.join(", ")}. The token is for TrueNorthIT/gh-repos-sandbox only.`);
  process.exit(2);
}
