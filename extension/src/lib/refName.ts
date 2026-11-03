// Git ref-name checks shared by branch and tag creation (B-5, T-2). STUB: the developer implements it.

export type RefNameErrorCode =
  | "empty"
  | "space"
  | "double-dot"
  | "forbidden-char"
  | "leading-slash"
  | "leading-dash"
  | "trailing-lock"
  | "trailing-slash"
  | "empty-segment"
  | "exists";

export type RefNameCheck = { ok: true } | { ok: false; code: RefNameErrorCode; reason: string };

/**
 * `git check-ref-format` basics for a short name (no `refs/heads/` prefix), then a duplicate check against `existing`.
 * The first failing rule wins, in the order of RefNameErrorCode above; `reason` is a sentence for the user.
 */
export function validateRefName(name: string, existing: Iterable<string>): RefNameCheck {
  const bad = (code: RefNameErrorCode, reason: string): RefNameCheck => ({ ok: false, code, reason });
  if (name === "") return bad("empty", "Enter a name.");
  if (/\s/.test(name)) return bad("space", "The name can't contain spaces.");
  if (name.includes("..")) return bad("double-dot", "The name can't contain '..'.");
  if (/[~^:?*[\\]/.test(name)) return bad("forbidden-char", "The name can't contain ~ ^ : ? * [ or a backslash.");
  if (name.startsWith("/")) return bad("leading-slash", "The name can't start with '/'.");
  if (name.startsWith("-")) return bad("leading-dash", "The name can't start with '-'.");
  if (name.endsWith(".lock")) return bad("trailing-lock", "The name can't end with '.lock'.");
  if (name.endsWith("/")) return bad("trailing-slash", "The name can't end with '/'.");
  if (name.includes("//")) return bad("empty-segment", "The name can't contain an empty path segment ('//').");
  for (const e of existing) if (e === name) return bad("exists", `'${name}' already exists.`);
  return { ok: true };
}
