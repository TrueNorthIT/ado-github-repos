// Page-scoped messaging between the hub frame and the header breadcrumb frame. Both are served from the publisher's CDN
// origin and are siblings under the ADO page, so they can find each other through window.parent.frames. (0.11.0 used a
// BroadcastChannel, which also reached other tabs: another tab's hub could put its repo in this page's header.)
export type RepoMessage =
  | { type: "tn-gh-hello" }
  | { type: "tn-gh-repo"; repo?: string };

/** The same-origin sibling frame whose path ends with `file`. In mock mode (no parent) both sides share this window. */
export function sibling(file: string): Window | undefined {
  if (window.parent === window) return window;
  try {
    const frames = window.parent.frames;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f === window) continue;
      try {
        if (f.location.origin === location.origin && f.location.pathname.endsWith("/" + file)) return f;
      } catch { /* a frame from another origin */ }
    }
  } catch { /* no access to the parent's frames */ }
  return undefined;
}

export const post = (to: Window | MessageEventSource | null | undefined, m: RepoMessage) => (to as Window | undefined)?.postMessage(m, location.origin);

export function onRepoMessage(cb: (m: RepoMessage, source: MessageEventSource | null) => void) {
  window.addEventListener("message", (e) => {
    const t = (e.data as { type?: unknown } | null)?.type;
    if (e.origin === location.origin && typeof t === "string" && t.startsWith("tn-gh-")) cb(e.data as RepoMessage, e.source);
  });
}
