// A workflow run (ACT-5..12, 14, 15, 17): summary, job graph, artifacts, annotations, re-run/cancel/review, live refresh, and the job log view.
// PLACEHOLDER with the FROZEN signature: the run/log agent replaces the body.
import * as React from "react";
import type { ActionsHashState } from "./lib/actionsHash";

export interface RunPageProps {
  repo: string;
  /** The parsed hash; `run` is set. */
  state: ActionsHashState;
  /** Navigate within the Actions hub (writes the hash with applyActions/serializeActions). */
  go: (s: Omit<ActionsHashState, "repo">, replace?: boolean) => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
}

export function RunPage({ state }: RunPageProps) {
  return <div className="page-content">Run {state.run}</div>;
}
