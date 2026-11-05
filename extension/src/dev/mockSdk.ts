// __TN_MOCK__ Stand-in for azure-devops-extension-sdk, aliased in by build.mjs --dev. Implements only what the app calls.
import type { GitHubTokenSet } from "../../../shared/contract";
import { LIVE } from "./live";

export const scenario = () => new URLSearchParams(location.search).get("scenario") || "ok";
/** Which hub contribution the mock page pretends to be: `?hub=commits|pushes|branches|tags|prs|actions|security`; anything else is Files. Read only here. */
export const MOCK_HUBS = ["repos", "commits", "pushes", "branches", "tags", "prs", "actions", "security", "myprs"] as const;
export const mockHub = () => {
  const h = new URLSearchParams(location.search).get("hub");
  if (h === "myprs") return "github-my-prs-hub"; // the organisation-level GitHub pull requests page
  return h === "repos" || !h || !(MOCK_HUBS as readonly string[]).includes(h) ? "github-repos-hub" : `github-repos-${h}-hub`;
};

// ---------- storage: ADO extension data (User scope), mirrored to localStorage so a refresh keeps it ----------
const PREFIX = "tn-mock:";
const docs = new Map<string, any>();
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(PREFIX + "doc:")) docs.set(k.slice(PREFIX.length + 4), JSON.parse(localStorage.getItem(k)!));
  }
} catch { /* storage blocked: in-memory only */ }
const persist = (key: string, v: any) => {
  try { v === undefined ? localStorage.removeItem(PREFIX + "doc:" + key) : localStorage.setItem(PREFIX + "doc:" + key, JSON.stringify(v)); } catch { /* ignore */ }
};

export const fakeTokens = (): GitHubTokenSet => ({
  accessToken: LIVE ? "live-token-held-by-dev-server" : "mock-access-token", // live: the dev server's /__gh proxy swaps in the real token
  expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString(),
  refreshToken: "mock-refresh-token",
  refreshTokenExpiresAt: new Date(Date.now() + 180 * 86400e3).toISOString(),
});

// Seed a signed-in user unless the scenario says otherwise. Signing out sticks until "reset storage" or a sign-in.
const TOKENS = "github-auth/tokens";
try {
  if (LIVE) {
    docs.set(TOKENS, { id: "tokens", ...fakeTokens() }); // signed in with a placeholder (the dev server holds the token); never written to localStorage
  } else if (scenario() === "signedOut") {
    docs.delete(TOKENS); persist(TOKENS, undefined);
    localStorage.removeItem(PREFIX + "seeded");
  } else if (!localStorage.getItem(PREFIX + "seeded")) {
    docs.set(TOKENS, { id: "tokens", ...fakeTokens() }); persist(TOKENS, docs.get(TOKENS));
    // VW-9: the user last opened a few of the fixture PRs a week ago, so the list shows "updated since you viewed" on them.
    const old = new Date(Date.now() - 7 * 86400e3).toISOString();
    const prefs = { id: "prefs", graph: true, sideBySide: true, favourites: {}, lastViewed: { "truenorthit/github-repos#199": old, "truenorthit/github-repos#197": old, "truenorthit/github-repos#305": old } };
    docs.set("github-repos-prefs/prefs", prefs); persist("github-repos-prefs/prefs", prefs);
    localStorage.setItem(PREFIX + "seeded", "1");
  }
} catch { /* ignore */ }

export const resetStorage = () => {
  try { indexedDB.deleteDatabase("gh-repos-query-cache"); } catch { /* ignore */ } // queryPersist.tsx's saved reads
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== PREFIX + "theme").forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
};

const dataManager = {
  async getDocument(collection: string, id: string) {
    const d = docs.get(`${collection}/${id}`);
    if (!d) throw new Error("404: no such document");
    return structuredClone(d);
  },
  async setDocument(collection: string, doc: any) {
    docs.set(`${collection}/${doc.id}`, structuredClone(doc)); persist(`${collection}/${doc.id}`, doc);
    return doc;
  },
  async deleteDocument(collection: string, id: string) {
    docs.delete(`${collection}/${id}`); persist(`${collection}/${id}`, undefined);
  },
};

// ---------- host navigation: the real host keeps the hub state in the page hash ----------
const nav = {
  getHash: async () => location.hash,
  setHash: (h: string) => { location.hash = h; },
  replaceHash: (h: string) => { history.replaceState(null, "", "#" + h.replace(/^#+/, "")); window.dispatchEvent(new HashChangeEvent("hashchange")); }, // replaceState fires no event; the host adds the "#" itself; the host does notify
  // The real host loads the other hub's page; mock mode swaps the ?hub= switch and keeps the hash.
  navigate: (u: string) => { const n = new URL(location.href); if (!n.pathname.endsWith("/hub.html")) { n.pathname = n.pathname.replace(/[^/]*$/, "hub.html"); n.search = ""; } n.searchParams.set("hub", /github-my-prs-hub(?:[\/#]|$)/.test(u) ? "myprs" : /github-repos-(commits|pushes|branches|tags|prs|actions|security)-hub(?:[\/#]|$)/.exec(u)?.[1] ?? "repos"); n.hash = new URL(u).hash; location.href = n.href; },
  onHashChanged: (cb: (h: string) => void) => window.addEventListener("hashchange", () => cb(location.hash)),
};

// Azure DevOps' directory (the identity picker's service): one person, found by email or (for IdentityCard's refetch) by entity id.
const ADO_PEOPLE = [{
  entityId: "ado-gwen", entityType: "User", originDirectory: "aad", originId: "aad-gwen", localId: "local-gwen", displayName: "Gwen Git", mail: "gwen.git@contoso.example",
  signInAddress: "gwen.git@contoso.example", jobTitle: "Senior Developer", department: "Platform Engineering", physicalDeliveryOfficeName: "Leeds", surname: "Git", mailNickname: "gwen.git",
}];
const identityService = {
  searchIdentitiesAsync: async (query: string, _types?: string[], _scopes?: string[], hint?: string) =>
    ADO_PEOPLE.filter((p) => (hint === "uid" ? p.entityId === query : [p.mail, p.signInAddress, p.displayName].some((v) => v.toLowerCase().includes(query.trim().toLowerCase())))),
  getConnections: async () => ({ managers: [], directReports: [] }),
};

const services: Record<string, any> = {
  "ms.vss-features.identity-service": identityService,
  "ms.vss-features.host-navigation-service": nav,
  "ms.vss-tfs-web.tfs-page-data-service": { getProject: async () => ({ id: "proj-1", name: "Demo Project" }) },
  "ms.vss-features.extension-data-service": { getExtensionDataManager: async () => dataManager },
};

// ---------- theme: the real SDK writes the host theme into CSS custom properties on :root and fires "themeApplied" ----------
const LIGHT = { "background-color": "rgba(255, 255, 255, 1)", "text-primary-color": "rgba(0, 0, 0, .9)", "text-secondary-color": "rgba(0, 0, 0, .55)" };
const neutral: Record<string, string> = { "0": "31,31,31", "2": "36,36,36", "4": "43,43,43", "6": "50,50,50", "8": "58,58,58", "10": "70,70,70", "20": "96,96,96", "30": "130,130,130", "80": "220,220,220", "100": "255,255,255" };
const DARK: Record<string, string> = {
  "background-color": "rgba(31, 31, 31, 1)", "callout-background-color": "rgba(43, 43, 43, 1)", "callout-filtered-background-color": "rgba(43, 43, 43, .86)",
  "text-primary-color": "rgba(255, 255, 255, .9)", "text-secondary-color": "rgba(255, 255, 255, .6)", "text-disabled-color": "rgba(255, 255, 255, .38)", "text-on-communication-background": "rgba(255, 255, 255, 1)",
  "communication-background": "rgba(0, 120, 212, 1)", "communication-foreground": "rgba(90, 170, 240, 1)", "focus-border-color": "rgba(90, 170, 240, 1)", "focus-pulse-max-color": "rgba(90, 170, 240, .3)",
  "component-grid-cell-bottom-border-color": "rgba(58, 58, 58, 1)", "component-grid-row-hover-color": "rgba(255, 255, 255, .05)", "component-grid-selected-row-color": "rgba(24, 42, 62, 1)",
  "component-grid-action-selected-cell-hover-color": "rgba(28, 52, 78, 1)", "component-grid-focus-border-color": "rgba(90, 170, 240, 1)", "component-grid-drag-source-color": "rgba(0, 0, 0, .4)",
  "component-label-default-color": "rgba(58, 58, 58, 1)", "component-label-default-color-hover": "rgba(70, 70, 70, 1)",
  "splitter-border-color": "rgba(255, 255, 255, .42)", "callout-shadow-color": "rgba(0, 0, 0, .5)", "callout-shadow-secondary-color": "rgba(0, 0, 0, .4)", "panel-shadow-color": "rgba(0, 0, 0, .5)", "panel-shadow-secondary-color": "rgba(0, 0, 0, .4)",
  "status-error-background": "rgba(70, 30, 30, 1)", "status-error-foreground": "rgba(240, 100, 95, 1)", "status-error-strong": "rgba(255, 130, 125, 1)", "status-error-text": "rgba(255, 130, 125, 1)",
  "status-info-foreground": "rgba(90, 170, 240, 1)", "status-success-background": "rgba(30, 55, 32, 1)", "status-success-foreground": "rgba(100, 200, 100, 1)",
  "status-warning-background": "rgba(60, 45, 30, 1)", "status-warning-icon-foreground": "rgba(230, 185, 80, 1)", "status-warning-text": "rgba(240, 170, 90, 1)",
  "palette-primary-darkened-6": "0,110,195", "palette-primary-darkened-10": "0,100,180", "palette-primary-shade-10": "40,140,225", "palette-primary-shade-20": "80,160,235", "palette-primary-shade-30": "120,185,240",
  "palette-primary-tint-10": "43,136,216", "palette-primary-tint-20": "28,52,78", "palette-primary-tint-30": "24,42,62", "palette-primary-tint-40": "20,34,50",
  "palette-accent3": "214,127,60", "palette-error": "rgba(240, 70, 80, 1)", "palette-error-6": "rgba(225, 60, 70, 1)", "palette-error-10": "rgba(205, 50, 60, 1)",
  "component-status-error": "rgba(205, 74, 69, 1)", "component-status-info": "rgba(0, 120, 212, 1)", "component-status-neutral": "rgba(160, 160, 160, 1)", "component-status-success": "rgba(85, 163, 98, 1)", "component-status-warning": "rgba(214, 127, 60, 1)",
  "third-party-icon-filter": "invert(1) hue-rotate(180deg)",
};
for (const [k, v] of Object.entries(neutral)) DARK[`palette-neutral-${k}`] = v;
for (const a of [2, 4, 6, 8, 10, 20, 30, 60]) DARK[`palette-black-alpha-${a}`] = `rgba(255, 255, 255, ${a / 100})`;

let themeEl: HTMLStyleElement | undefined;
export function applyTheme(theme: Record<string, string>) {
  themeEl ??= document.head.appendChild(document.createElement("style"));
  themeEl.textContent = `:root { ${Object.entries(theme).map(([k, v]) => `--${k}: ${v}`).join("; ")} } body { color: var(--text-primary-color); background: var(--background-color) }`;
  window.dispatchEvent(new CustomEvent("themeApplied", { detail: theme }));
}
/** `?theme=light|dark` wins (headless screenshots, npm run shots), then the toolbar's stored choice. */
export const isMockDark = () => { const q = new URLSearchParams(location.search).get("theme"); if (q === "dark" || q === "light") return q === "dark"; try { return localStorage.getItem(PREFIX + "theme") === "dark"; } catch { return false; } };
export function setMockTheme(dark: boolean) {
  try { localStorage.setItem(PREFIX + "theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  applyTheme(dark ? DARK : LIGHT);
}

// ---------- the SDK surface the app uses ----------
export async function init(_opts?: unknown) { setMockTheme(isMockDark()); }
export const ready = async () => {};
// Breadcrumb providers register an object (or factory); the fake header (fakeHeader.ts) reads it back like the host does:
// call getBreadcrumbItems() if present, otherwise use the object itself as the observable list.
const registered = new Map<string, unknown>();
export const register = (id: string, instance: unknown) => { registered.set(id, instance); };
export const unregister = (id: string) => { registered.delete(id); };
export const registeredService = (id: string) => {
  const r = registered.get(id);
  const o = typeof r === "function" ? r() : r;
  return o && typeof (o as { getBreadcrumbItems?: unknown }).getBreadcrumbItems === "function" ? (o as { getBreadcrumbItems: () => unknown }).getBreadcrumbItems() : o;
};
/** widget.html?widget=prs|runs[&config=1] pretends to be a dashboard widget (or its configuration); see widgetMain.ts. */
export const mockWidget = () => { const q = new URLSearchParams(location.search); const w = q.get("widget"); return w === "prs" || w === "runs" ? `github-${w}-widget${q.get("config") ? "-config" : ""}` : undefined; };
export const getContributionId = () => `TrueNorthIT.github-repos.${mockWidget() ?? mockHub()}`;
export const notifyLoadFailed = async (e: unknown) => { console.error("[mock sdk] load failed", e); };
/** The object a widget frame registered, as the dashboard host would fetch it (factories are called). */
export const registeredObject = (id: string) => { const r = registered.get(id); return typeof r === "function" ? r() : r; };
export const notifyLoadSucceeded = async () => {};
export const getConfiguration = () => ({});
export const resize = (_w?: number, _h?: number) => {};
export const getAccessToken = async () => "mock-ado-token";
export const getService = async <T>(id: string): Promise<T> => services[id];
export const getHost = () => ({ id: "host-1", name: "demo-org", type: 2 });
// The user id carries the scenario, so queryPersist.tsx keeps one record per scenario: a list saved under "ok" would otherwise hide a failure scenario's error.
export const getUser = () => ({ id: `user-1|${scenario()}${LIVE ? "|live" : ""}`, name: "mock@example.com", displayName: "Mock User", descriptor: "", imageUrl: "" });
export const getExtensionContext = () => ({ id: "mock-extension", extensionId: "github-repos", publisherId: "TrueNorthIT", version: "0.0.0" });
export const getWebContext = () => ({ account: { name: "demo-org" }, project: { id: "proj-1", name: "Demo Project" } });
