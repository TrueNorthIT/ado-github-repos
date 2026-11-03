/** The parts of a Files hub address that leave an edit behind when they change. */
export interface NavWhere { repo?: string; ref?: string; path?: string; tab?: string; view?: string }

const same = (a: NavWhere, b: NavWhere) =>
  (a.repo ?? "") === (b.repo ?? "") && (a.ref ?? "") === (b.ref ?? "") && (a.path ?? "") === (b.path ?? "") &&
  (a.tab ?? "contents") === (b.tab ?? "contents") && (a.view ?? "") === (b.view ?? "");

/** "ask" when navigating from `cur` to `next` would throw away unsaved edits. */
export const decideNav = (dirty: boolean, cur: NavWhere, next: NavWhere): "allow" | "ask" =>
  dirty && !same(cur, next) ? "ask" : "allow";
