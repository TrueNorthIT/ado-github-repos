// __TN_MOCK__ Dev-only entry point of myWorkTab.html (build.mjs --dev): installs the mocks, then starts the real tab, framed like the
// My work flyout (about 640px wide on the neutral surface). ?scenario=signedOut|rateLimit as elsewhere.
import { installMockFetch } from "./mockFetch";

installMockFetch();
const root = document.getElementById("root")!;
root.style.cssText = "width:640px;margin:16px;box-shadow:0 6.4px 14.4px 0 rgba(0,0,0,.132),0 1.2px 3.6px 0 rgba(0,0,0,.108)";
void import("../myWorkTab");
