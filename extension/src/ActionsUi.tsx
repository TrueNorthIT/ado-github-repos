// Small parts of the Actions area used by both the lists and the run page.
import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import type { RunState } from "./lib/workflows";
import { deleteRun, deleteRunLogs } from "./actionsApi";
import { GhError } from "./githubBrowse";

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

/** What a failed Actions write says: GitHub's own message when there is one. */
export function writeError(e: unknown, what: string): string {
  const d = e instanceof GhError ? e.apiMessage ?? e.detail ?? (e.kind === "access" ? "GitHub refused it (the app may lack Actions write permission)" : "") : "";
  return `Could not ${what}${d ? `: ${d}` : "."}`;
}

export interface DeleteTarget {
  id: number;
  runNumber: number;
  title: string;
  /** Delete only the logs, keeping the run. */
  logsOnly: boolean;
}

/** Native Pipelines' "Delete" confirmation, for a run or only its logs. Calls onDeleted once GitHub has accepted it. */
export function DeleteRunDialog({ repo, target, onClose, onDeleted }: { repo: string; target: DeleteTarget; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await (target.logsOnly ? deleteRunLogs : deleteRun)(repo, target.id);
      onDeleted();
    } catch (e) {
      setError(writeError(e, target.logsOnly ? "delete the logs" : "delete the run"));
      setBusy(false);
    }
  };
  return (
    <Dialog
      titleProps={{ text: target.logsOnly ? "Delete logs" : "Delete run" }}
      onDismiss={busy ? () => undefined : onClose}
      footerButtonProps={[
        { text: "Cancel", onClick: onClose, disabled: busy },
        { text: busy ? "Deleting" : target.logsOnly ? "Delete logs" : "Delete run", primary: true, danger: true, disabled: busy, onClick: () => void confirm() },
      ]}
    >
      <div className="flex-column gh-dialog-form">
        {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>{error}</MessageCard>}
        <div>
          {target.logsOnly
            ? <>Delete the logs of run <strong>#{target.runNumber} {target.title}</strong>? The run, its jobs and its artifacts stay. This cannot be undone.</>
            : <>Delete run <strong>#{target.runNumber} {target.title}</strong>? Its logs and artifacts go with it. This cannot be undone.</>}
        </div>
      </div>
    </Dialog>
  );
}
