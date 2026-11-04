// __TN_MOCK__ Dev-only entry point (build.mjs --dev): installs the mocks and the toolbar, then starts the real app.
import { AUTH_MESSAGE_TYPE } from "../../../shared/contract";
import { AUTH_BASE } from "../config";
import { installMockFetch } from "./mockFetch";
import { LIVE } from "./live";
import { MOCK_HUBS, fakeTokens, isMockDark, resetStorage, scenario, setMockTheme } from "./mockSdk";

installMockFetch();

// "Sign in with GitHub" opens a popup on the auth function; answer it with a fake token instead, so auth.ts is unchanged.
const realOpen = window.open.bind(window);
window.open = (url?: string | URL, ...rest: any[]) => {
  if (!String(url).startsWith(`${AUTH_BASE}/api/auth/start`)) return realOpen(url, ...rest);
  const popup = { closed: false, close() { this.closed = true; } };
  setTimeout(() => {
    const e = new MessageEvent("message", { data: { type: AUTH_MESSAGE_TYPE, ok: true, tokens: fakeTokens() }, origin: new URL(AUTH_BASE).origin });
    Object.defineProperty(e, "source", { value: popup });
    window.dispatchEvent(e);
    popup.closed = true;
  }, 400);
  return popup as unknown as Window;
};

const SCENARIOS = ["ok", "signedOut", "noConnections", "forbidden", "rateLimit", "commitsFail", "noAccess", "workItemsDenied", "slow", "actionsFail", "headMoved", "workItemsReadOnly", "refsFail", "queued", "copilotRefused", "readOnlyViewer", "editFails", "noProjectsAccess", "pendingReview", "suggestions", "editedComment", "minimisedComment", "reactions", "viewedFails", "noReview", "dependabotDisabled", "codeNoAnalysis", "secretNoPermission", "dismissFails", "searchRateLimit", "searchSecondary", "searchInvalid", "noWorkflowsPermission", "cherryPickConflict", "readOnly"];

function toolbar() {
  const bar = document.createElement("div");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Mock mode controls");
  bar.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:2147483647;display:flex;gap:6px;align-items:center;padding:4px 6px;font:11px Segoe UI,sans-serif;background:rgba(40,40,40,.85);color:#fff;border-radius:4px;opacity:.65";
  bar.onmouseenter = () => (bar.style.opacity = "1");
  bar.onmouseleave = () => (bar.style.opacity = ".65");
  const btn = (text: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "font:inherit;padding:1px 6px;cursor:pointer;background:#555;color:#fff;border:1px solid #777";
    b.onclick = onClick;
    return b;
  };
  const theme = btn("", () => { setMockTheme(!isMockDark()); theme.textContent = isMockDark() ? "Light" : "Dark"; });
  theme.textContent = isMockDark() ? "Light" : "Dark";
  theme.title = "Switch theme";
  const hub = document.createElement("select");
  hub.title = "Which hub this page pretends to be";
  hub.setAttribute("aria-label", "Hub");
  hub.style.cssText = "font:inherit;background:#555;color:#fff;border:1px solid #777";
  const cur = new URLSearchParams(location.search).get("hub") ?? "repos";
  for (const h of MOCK_HUBS) hub.add(new Option(h === "repos" ? "Files" : h === "prs" ? "Pull requests" : h === "security" ? "Advanced Security" : h[0].toUpperCase() + h.slice(1), h, false, h === cur));
  hub.onchange = () => { const u = new URL(location.href); u.searchParams.set("hub", hub.value); location.href = u.href; };
  const label = document.createElement("label");
  label.append("Scenario ");
  const sel = document.createElement("select");
  sel.style.cssText = "font:inherit;background:#555;color:#fff;border:1px solid #777";
  SCENARIOS.forEach((s) => sel.add(new Option(s, s, false, s === scenario())));
  sel.onchange = () => { const u = new URL(location.href); u.searchParams.set("scenario", sel.value); location.href = u.href; };
  label.append(sel);
  bar.append(LIVE ? "LIVE (sandbox) " : "MOCK ", hub, theme, label, btn("Reset storage", () => { resetStorage(); location.reload(); }));
  document.body.append(bar);
}

SCENARIOS.push("releaseSaveFails", "releaseNoAccess");
SCENARIOS.push("noEnvironments"); // Actions > Environments with none
SCENARIOS.push("noVariablesPermission", "noSecretsPermission", "notAdmin", "manyVariables"); // batch K: Actions > Library without the app's Variables or Secrets permission, or as a non-admin
SCENARIOS.push("rebaseConflict", "rebaseStuck", "mergeBlocked", "noCodeOwners", "forkDenied", "noForks"); // batch H: the semi-linear merge's failures, a branch without CODEOWNERS
SCENARIOS.push("rulesetsDenied", "rulesetsInvalid");
SCENARIOS.push("hoverFails"); // hover cards: the profile and pull request lookups fail (quiet error line) // batch J: an admin whose GitHub App may not write rulesets, and GitHub refusing the rules

// `?click=a|b|…`: once the page is up, click each target in turn (a CSS selector, or `text:Label` for the innermost element showing
// exactly that text). For screenshots of panels and menus that only open on a click (npm run shots). Before each click it waits (up to
// 8 s) for the target to be present and enabled AND for the page to settle: no fetch in flight and no shimmer rows or spinners for
// 300 ms. Otherwise a click can land before the data does (a branch's lock state arriving after its menu opened, say) and the shot flakes.
// A `hover:` prefix (`hover:.gh-pr-ref`, `hover:text:AB#1000`) rests the pointer on the target instead (a mouseover with no relatedTarget, which
// React turns into onMouseEnter), then waits out the hover card's delay and its lookup.
const clicks = new URLSearchParams(location.search).get("click");
if (clicks) {
  let inFlight = 0;
  const mocked = window.fetch;
  window.fetch = (...a: Parameters<typeof fetch>) => {
    inFlight++;
    return mocked(...a).finally(() => inFlight--);
  };
  // Only spinners on screen count: a lazy diff below the fold keeps its spinner until it is scrolled to.
  const onScreen = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  const busy = () => inFlight > 0 || Array.from(document.querySelectorAll(".shimmer, .bolt-spinner")).some(onScreen);
  const find = (t: string): HTMLElement | null => {
    if (!t.startsWith("text:")) return document.querySelector<HTMLElement>(t);
    const want = t.slice(5);
    const all = Array.from(document.querySelectorAll<HTMLElement>("button, [role=option], [role=menuitem], [role=tab], a, span, div")).filter((e) => e.textContent?.trim() === want);
    const hit = all.find((e) => !Array.from(e.children).some((c) => c.textContent?.trim() === want)) ?? null;
    return hit && (hit.closest("button") as HTMLButtonElement | null)?.disabled !== true && !hit.closest("[aria-disabled=true]") ? hit : null; // wait until it is enabled
  };
  (async () => {
    for (const step of clicks.split("|")) {
      const hover = step.startsWith("hover:");
      const t = hover ? step.slice(6) : step;
      let el: HTMLElement | null = null;
      let quiet = 0;
      for (let i = 0; i < 80; i++) {
        el = find(t);
        quiet = busy() ? 0 : quiet + 1;
        if (el && quiet >= 3) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!el) return console.warn(`[mock click] not found: ${t}`);
      if (quiet < 3) console.warn(`[mock click] page still busy, clicking anyway: ${t}`);
      if (hover) {
        el.scrollIntoView({ block: "center" });
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); // no relatedTarget: React 16 reads that as the pointer arriving from outside
        for (let a: HTMLElement | null = el; a; a = a.parentElement) a.dispatchEvent(new MouseEvent("mouseenter")); // as a browser does, for native listeners
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      el.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
}
toolbar();
import("./fakeHeader").then((m) => m.fakeHeader());
import("../index");
