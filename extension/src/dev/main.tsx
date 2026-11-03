// __TN_MOCK__ Dev-only entry point (build.mjs --dev): installs the mocks and the toolbar, then starts the real app.
import { AUTH_MESSAGE_TYPE } from "../../../shared/contract";
import { AUTH_BASE } from "../config";
import { installMockFetch } from "./mockFetch";
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

const SCENARIOS = ["ok", "signedOut", "noConnections", "forbidden", "rateLimit", "commitsFail", "noAccess", "workItemsDenied", "slow", "actionsFail", "headMoved", "workItemsReadOnly", "refsFail", "queued", "copilotRefused"];

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
  for (const h of MOCK_HUBS) hub.add(new Option(h === "repos" ? "Files" : h === "prs" ? "Pull requests" : h[0].toUpperCase() + h.slice(1), h, false, h === cur));
  hub.onchange = () => { const u = new URL(location.href); u.searchParams.set("hub", hub.value); location.href = u.href; };
  const label = document.createElement("label");
  label.append("Scenario ");
  const sel = document.createElement("select");
  sel.style.cssText = "font:inherit;background:#555;color:#fff;border:1px solid #777";
  SCENARIOS.forEach((s) => sel.add(new Option(s, s, false, s === scenario())));
  sel.onchange = () => { const u = new URL(location.href); u.searchParams.set("scenario", sel.value); location.href = u.href; };
  label.append(sel);
  bar.append("MOCK ", hub, theme, label, btn("Reset storage", () => { resetStorage(); location.reload(); }));
  document.body.append(bar);
}

toolbar();
import("./fakeHeader").then((m) => m.fakeHeader());
import("../index");
