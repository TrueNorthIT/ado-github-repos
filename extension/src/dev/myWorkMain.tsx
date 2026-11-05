// __TN_MOCK__ Dev-only entry point of myWorkTab.html (build.mjs --dev): installs the mocks, then starts the real tab in a box the size
// of ADO's My work flyout tab (about 640 x 820, ?height= to change). ?scenario=signedOut|rateLimit|noProjectScope|noConnections as elsewhere.
import { installMockFetch } from "./mockFetch";

installMockFetch();
const h = Number(new URLSearchParams(location.search).get("height")) || 820;
const root = document.getElementById("root")!;
document.documentElement.style.height = document.body.style.height = "auto";
root.style.cssText = `width:640px;height:${h}px;margin:16px;box-shadow:0 6.4px 14.4px 0 rgba(0,0,0,.132),0 1.2px 3.6px 0 rgba(0,0,0,.108)`;
void import("../myWorkTab");
