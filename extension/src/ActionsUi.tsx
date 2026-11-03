// Small parts of the Actions area used by both the lists and the run page.
import * as React from "react";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import type { RunState } from "./lib/workflows";

export const RUN_STATE_TEXT: Record<RunState, string> = {
  queued: "Queued",
  waiting: "Waiting",
  inProgress: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  neutral: "Neutral",
};

const STATE_STATUS = {
  queued: Statuses.Queued,
  waiting: Statuses.Waiting,
  inProgress: Statuses.Running,
  succeeded: Statuses.Success,
  failed: Statuses.Failed,
  cancelled: Statuses.Canceled,
  skipped: Statuses.Skipped,
  neutral: Statuses.Information,
} as const;

/** ADO Pipelines' status icon for a run, job or step state. */
export const RunStatusIcon = ({ state, size = StatusSize.l }: { state: RunState; size?: StatusSize }) => (
  <Status {...STATE_STATUS[state]} size={size} ariaLabel={RUN_STATE_TEXT[state]} animated={state === "inProgress"} />
);
