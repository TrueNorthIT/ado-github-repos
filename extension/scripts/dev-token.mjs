// A GitHub App user token (ghu_…) for the dev app, through device flow: no client secret, no callback.
// Same kind of token the extension uses in ADO (the app's permissions, as you), limited to the repos the dev app is installed on.
//
//   node scripts/dev-token.mjs <dev app client ID>
//
// Run it in your own terminal, not through an agent: it prints the token at the end, and it copies it to the clipboard where it can.
// Needs "Enable Device Flow" on the app. With "Expire user authorization tokens" off, the token lasts until you revoke it
// (github.com → Settings → Applications → Authorized GitHub Apps, or the app's settings).
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const clientId = process.argv[2];
if (!clientId) { console.error("Usage: node scripts/dev-token.mjs <client ID of the dev GitHub App>"); process.exit(2); }

const post = async (url, body) => {
  const res = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
};

const code = await post("https://github.com/login/device/code", { client_id: clientId });
if (!code.device_code) { console.error("GitHub refused the device code request:", code.error_description || code.error || code); process.exit(1); }
console.log(`\n1. Open ${code.verification_uri}\n2. Enter the code: ${code.user_code}\n3. Approve the app. Waiting…\n`);

let wait = (code.interval || 5) * 1000;
let token;
for (const end = Date.now() + code.expires_in * 1000; Date.now() < end; ) {
  await sleep(wait);
  const r = await post("https://github.com/login/oauth/access_token", { client_id: clientId, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (r.access_token) { token = r.access_token; break; }
  if (r.error === "slow_down") wait += 5000;
  else if (r.error !== "authorization_pending") { console.error("Device flow failed:", r.error_description || r.error); process.exit(1); }
}
if (!token) { console.error("The code expired before it was approved. Run the script again."); process.exit(1); }

// Show what the token can reach, so a wrongly installed app is obvious before the token goes anywhere.
const api = async (path) => (await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } })).json();
const user = await api("/user");
const inst = await api("/user/installations");
console.log(`Signed in as ${user.login}. ${token.startsWith("ghu_") ? "App user token." : "Unexpected token type."}`);
for (const i of inst.installations ?? []) {
  const repos = await api(`/user/installations/${i.id}/repositories?per_page=100`);
  console.log(`  ${i.account.login}: ${i.repository_selection} -> ${(repos.repositories ?? []).map((r) => r.full_name).join(", ") || "(none)"}`);
}
if ((inst.installations ?? []).some((i) => i.repository_selection === "all")) console.log("\n  WARNING: installed on ALL repositories. Limit it to the sandbox before using this token.");

const copied = [["clip"], ["pbcopy"], ["xclip", "-selection", "clipboard"]].some(([cmd, ...args]) => spawnSync(cmd, args, { input: token, shell: process.platform === "win32" }).status === 0);
console.log(`\nToken${copied ? " (also copied to the clipboard)" : ""}:\n${token}\n\nPut it in the cloud environment as GH_SANDBOX_TOKEN. Don't paste it into chat.`);
