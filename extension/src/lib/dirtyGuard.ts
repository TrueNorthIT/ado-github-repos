/** The parts of an address that leave an edit behind when they change: a Files hub edit, or the release form (tagTab, release, releaseForm). */
export interface NavWhere { repo?: string; ref?: string; path?: string; tab?: string; view?: string; tagTab?: string; release?: string; releaseForm?: string }

const same = (a: NavWhere, b: NavWhere) =>
  (a.repo ?? "") === (b.repo ?? "") && (a.ref ?? "") === (b.ref ?? "") && (a.path ?? "") === (b.path ?? "") &&
  (a.tab ?? "contents") === (b.tab ?? "contents") && (a.view ?? "") === (b.view ?? "") &&
  (a.tagTab ?? "") === (b.tagTab ?? "") && (a.release ?? "") === (b.release ?? "") && (a.releaseForm ?? "") === (b.releaseForm ?? "");

/** "ask" when navigating from `cur` to `next` would throw away unsaved edits. */
export const decideNav = (dirty: boolean, cur: NavWhere, next: NavWhere): "allow" | "ask" =>
  dirty && !same(cur, next) ? "ask" : "allow";
