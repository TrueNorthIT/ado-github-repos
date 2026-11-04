// `edit=true` in a Files hub link opens the file at `path` straight in the editor (native Pipelines' "Edit" on a pipeline opens its YAML
// in an editor; ours is the Files hub's). browseState.parse drops the key, so it is read from the raw hash (hostNav's useHashExtras),
// and the Files hub removes it once the editor is open, so a reload or Back does not open it again.

const KEY = "edit";

/** Whether the hash asks for the editor. Never throws. */
export function parseEditFlag(hash: string): boolean {
  try {
    const v = new URLSearchParams(hash.replace(/^#+/, "")).get(KEY);
    return v === "true" || v === "1";
  } catch {
    return false;
  }
}

/** `hash` with the edit key set or removed; other segments keep their order. Starts with "#". */
export function applyEditFlag(hash: string, on: boolean): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && x.split("=")[0] !== KEY);
  if (on) kept.push(`${KEY}=true`);
  return "#" + kept.join("&");
}
