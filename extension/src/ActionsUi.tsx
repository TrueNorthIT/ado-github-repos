// Small parts of the Actions area used by both the lists and the run page.
import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { ClipboardButton } from "azure-devops-ui/Components/ClipboardButton/ClipboardButton";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { statusBadge, type RunState } from "./lib/workflows";
import { deleteRun, deleteRunLogs } from "./actionsApi";
import { GhError, listBranches } from "./githubBrowse";

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

/** Native Pipelines' "Status badge" dialog: GitHub's badge for the workflow on a branch, with its image URL and Markdown to copy. */
export function StatusBadgeDialog({ repo, path, name, defaultBranch, onClose }: { repo: string; path: string; name: string; defaultBranch: string; onClose: () => void }) {
  const [branches, setBranches] = React.useState<string[]>([defaultBranch]);
  const [branch, setBranch] = React.useState(defaultBranch);
  const [broken, setBroken] = React.useState<string>();
  React.useEffect(() => {
    let dead = false;
    listBranches(repo).then((b) => !dead && setBranches([defaultBranch, ...b.filter((x) => x !== defaultBranch)]), () => {});
    return () => { dead = true; };
  }, [repo, defaultBranch]);
  const badge = statusBadge(repo, path, name, branch);
  const selection = React.useMemo(() => new DropdownSelection(), []);
  React.useEffect(() => {
    const i = branches.indexOf(branch);
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [branches, branch, selection]);
  const copyField = (label: string, value: string, multiline = false) => (
    <FormItem label={label}>
      <div className="flex-row gh-badge-field">
        <TextField containerClassName="gh-badge-text" value={value} readOnly multiline={multiline} rows={multiline ? 4 : undefined} ariaLabel={label} spellCheck={false} width={TextFieldWidth.auto} />
        <ClipboardButton getContent={() => value} ariaLabel={`Copy the ${label.toLowerCase()}`} showCopiedTooltip />
      </div>
    </FormItem>
  );
  return (
    <Dialog titleProps={{ text: "Status badge" }} onDismiss={onClose} footerButtonProps={[{ text: "Close", primary: true, onClick: onClose }]}>
      <div className="flex-column gh-dialog-form gh-badge-form">
        <FormItem label="Branch">
          <Dropdown ariaLabel="Branch" items={branches.map((b) => ({ id: b, text: b }))} selection={selection} showFilterBox={branches.length > 8} onSelect={(_e, i) => setBranch(i.id)} />
        </FormItem>
        {/* Hand-rolled: an <img> is the badge itself; azure-devops-ui has no image component. */}
        <div className="gh-badge-preview">
          {broken === badge.imageUrl
            ? <span className="secondary-text">GitHub did not send the badge. For a private repository, sign in to github.com to see it.</span>
            : <img key={badge.imageUrl} src={badge.imageUrl} alt={`${name} status on ${branch}`} onError={() => setBroken(badge.imageUrl)} />}
        </div>
        {copyField("Image URL", badge.imageUrl)}
        {copyField("Sample markdown", badge.markdown, true)}
        <span className="secondary-text body-s">The badge comes from GitHub. For a private repository it only shows to people signed in to github.com with access to the repository.</span>
      </div>
    </Dialog>
  );
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
