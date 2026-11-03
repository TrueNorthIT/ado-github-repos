// Branch and tag writes (create, delete). Same rules as actionStore.ts: one at a time (shared by every page in this frame),
// buttons disabled while one is queued or running, a failure is shown as text, and a success drops the cached lists.
import * as React from "react";
import { actionErrorText } from "./actionStore";
import { invalidateRefs } from "./githubBrowse";

let chain: Promise<unknown> = Promise.resolve();

/** A failure the caller words itself (no commit with that ID); shown as written. */
export class RefWriteError extends Error {}

export interface RefWrites {
  /** A write is queued or running: disable the buttons. */
  busy: boolean;
  /** What went wrong with the last write; null after the next one starts. */
  error: string | null;
  clearError: () => void;
  /** Runs `task` after any earlier write. Resolves true on success; `done` then runs (refresh the list). */
  run: (task: () => Promise<unknown>, done?: () => void) => Promise<boolean>;
}

export function useRefWrites(): RefWrites {
  const [pending, setPending] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  const run = React.useCallback((task: () => Promise<unknown>, done?: () => void) => {
    setError(null);
    setPending((n) => n + 1);
    const step = chain.then(task).then(
      () => { invalidateRefs(); return true; },
      (e) => { if (alive.current) setError(e instanceof RefWriteError ? e.message : actionErrorText(e)); return false; }
    );
    chain = step;
    return step.then((ok) => {
      if (alive.current) setPending((n) => n - 1);
      if (ok) done?.();
      return ok;
    });
  }, []);
  return { busy: pending > 0, error, clearError: React.useCallback(() => setError(null), []), run };
}
