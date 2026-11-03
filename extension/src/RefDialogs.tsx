// The Branches and Tags dialogs: New branch, New tag and the delete confirmation.
import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { TextField } from "azure-devops-ui/TextField";
import { validateRefName } from "./lib/refName";
import { isShaPrefix } from "./lib/commitsQuery";

/** The name field with its live validation: the message appears once something has been typed. */
function NameField({ label, name, setName, existing, what }: { label: string; name: string; setName: (v: string) => void; existing: string[]; what: string }) {
  const check = validateRefName(name, existing);
  const shown = name !== "" && !check.ok ? check.reason : undefined;
  return (
    <FormItem label={label} required error={!!shown} message={shown}>
      <TextField value={name} onChange={(_e, v) => setName(v)} autoFocus required placeholder={`${what} name`} ariaLabel={`${what} name`} spellCheck={false} />
    </FormItem>
  );
}

export const isNameOk = (name: string, existing: string[]) => validateRefName(name, existing).ok;

const BaseBranch = ({ label, branches, value, setValue }: { label: string; branches: string[]; value: string; setValue: (b: string) => void }) => (
  <FormItem label={label}>
    <Dropdown
      ariaLabel={label}
      placeholder={value}
      items={branches.map((b) => ({ id: b, text: b }))}
      showFilterBox
      filterPlaceholderText="Find a branch"
      onSelect={(_e, i) => setValue(i.id)}
    />
  </FormItem>
);

const ErrorLine = ({ error, dismiss }: { error: string | null; dismiss: () => void }) =>
  error ? <MessageCard severity={MessageCardSeverity.Error} onDismiss={dismiss}>{error}</MessageCard> : null;

export function NewBranchDialog({ branches, existing, defaultBase, fixedBase, busy, error, clearError, create, close }: {
  branches: string[]; existing: string[]; defaultBase: string;
  /** A base that is not a branch (a tag's commit): shown as read-only text instead of the branch picker. */
  fixedBase?: string; busy: boolean; error: string | null; clearError: () => void;
  create: (name: string, base: string) => void; close: () => void;
}) {
  const [name, setName] = React.useState("");
  const [base, setBase] = React.useState(defaultBase);
  const ok = isNameOk(name, existing);
  return (
    <Dialog
      titleProps={{ text: "New branch" }}
      onDismiss={close}
      footerButtonProps={[{ text: "Cancel", onClick: close }, { text: "Create branch", primary: true, disabled: !ok || busy, onClick: () => create(name, base) }]}
    >
      <div className="gh-dialog-form flex-column">
        <ErrorLine error={error} dismiss={clearError} />
        <NameField label="Name" name={name} setName={setName} existing={existing} what="Branch" />
        {fixedBase ? (
          <FormItem label="Based on"><div>{fixedBase}</div></FormItem>
        ) : (
          <BaseBranch label="Based on" branches={branches} value={base} setValue={setBase} />
        )}
      </div>
    </Dialog>
  );
}

export function NewTagDialog({ branches, existing, defaultBase, presetSha, busy, error, clearError, create, close }: {
  branches: string[]; existing: string[]; defaultBase: string;
  /** Tag this commit: the commit ID is filled in and the branch picker is left out. */
  presetSha?: string; busy: boolean; error: string | null; clearError: () => void;
  create: (p: { name: string; base: string; sha: string; message: string }) => void; close: () => void;
}) {
  const [name, setName] = React.useState("");
  const [base, setBase] = React.useState(defaultBase);
  const [sha, setSha] = React.useState(presetSha ?? "");
  const [message, setMessage] = React.useState("");
  const shaBad = sha.trim() !== "" && !isShaPrefix(sha.trim());
  const ok = isNameOk(name, existing) && !shaBad;
  return (
    <Dialog
      titleProps={{ text: "New tag" }}
      onDismiss={close}
      footerButtonProps={[{ text: "Cancel", onClick: close }, { text: "Create tag", primary: true, disabled: !ok || busy, onClick: () => create({ name, base, sha: sha.trim(), message }) }]}
    >
      <div className="gh-dialog-form flex-column">
        <ErrorLine error={error} dismiss={clearError} />
        <NameField label="Name" name={name} setName={setName} existing={existing} what="Tag" />
        {!presetSha && <BaseBranch label="Based on" branches={branches} value={base} setValue={setBase} />}
        <FormItem label={presetSha ? "Commit ID" : "Or a commit ID"} error={shaBad} message={shaBad ? "Enter 4 to 40 hexadecimal characters." : presetSha ? "The tag points at this commit." : "Optional. Overrides the branch."}>
          <TextField value={sha} onChange={(_e, v) => setSha(v)} readOnly={!!presetSha} placeholder="Commit ID" ariaLabel="Commit ID" spellCheck={false} />
        </FormItem>
        <FormItem label="Description" message="Optional. With a description the tag is annotated; without one it is lightweight.">
          <TextField value={message} onChange={(_e, v) => setMessage(v)} multiline rows={4} placeholder="Tag message" ariaLabel="Tag description" />
        </FormItem>
      </div>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ what, name, busy, error, clearError, confirm, close }: { what: "branch" | "tag" | "release"; name: string; busy: boolean; error: string | null; clearError: () => void; confirm: () => void; close: () => void }) {
  return (
    <Dialog
      titleProps={{ text: `Delete ${what}` }}
      onDismiss={close}
      footerButtonProps={[{ text: "Cancel", onClick: close }, { text: `Delete ${what}`, primary: true, danger: true, disabled: busy, onClick: confirm }]}
    >
      <div className="flex-column gh-dialog-form">
        <ErrorLine error={error} dismiss={clearError} />
        <div>Delete {what} <strong>{name}</strong>? {what === "branch" ? "Open pull requests from it will be closed." : what === "release" ? "The tag it was made from is not deleted." : "The commit it points at is not deleted."}</div>
      </div>
    </Dialog>
  );
}
