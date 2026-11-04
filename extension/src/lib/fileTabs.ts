// Tabs of the Files page's file and folder views (Contents | Preview | History | Compare | Blame), kept in the existing `tab` hash key.
// browseState.parse already carries `tab` (any a-z word), so nothing there changes. The Compare tab's other ref lives in its own key, `against`,
// which browseState drops: it is read and written on the raw hash (hostNav's useHashExtras / patchHash), as newPrHash and securityHash do.

export type FileTab = "contents" | "preview" | "history" | "compare" | "blame";

/** Native: History for files and folders; Compare and Blame for files; Preview is ours, for markdown, CSV and TSV (`hasPreview`). */
export function tabsFor(kind: "file" | "folder", hasPreview: boolean): FileTab[] {
  return kind === "folder" ? ["contents", "history"] : ["contents", ...(hasPreview ? (["preview"] as const) : []), "history", "compare", "blame"];
}

/** The tab to show: the requested one if this view offers it, else the default (Preview where there is one, otherwise Contents). */
export function resolveTab(requested: string | undefined, kind: "file" | "folder", hasPreview: boolean): FileTab {
  const offered = tabsFor(kind, hasPreview);
  const hit = offered.find((t) => t === requested);
  return hit ?? (hasPreview && kind === "file" ? "preview" : "contents");
}

/** The `against` ref of a hash (the Compare tab's other side), or undefined. Never throws. */
export function parseAgainst(hash: string): string | undefined {
  try {
    const v = (new URLSearchParams(hash.replace(/^#+/, "")).get("against") ?? "").trim().slice(0, 255);
    return v || undefined;
  } catch {
    return undefined;
  }
}

/** `hash` with `against` replaced (or removed for a blank ref); other segments keep their order. Starts with "#". */
export function applyAgainst(hash: string, ref: string | undefined): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && x.split("=")[0] !== "against");
  const v = (ref ?? "").trim().slice(0, 255);
  if (v) kept.push(`against=${encodeURIComponent(v)}`);
  return "#" + kept.join("&");
}
