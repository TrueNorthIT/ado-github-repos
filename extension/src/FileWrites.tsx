// The pieces of the web editor (native Files: Edit, New, Upload, Rename, Delete): the Commit dialog every write goes through, the editable Monaco pane, and the write itself.
// The pure rules live in lib/fileCommit.ts.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { ContentSize } from "azure-devops-ui/Callout";
import { Dialog } from "azure-devops-ui/Dialog";
import { FormItem } from "azure-devops-ui/FormItem";
import { ITableColumn, SimpleTableCell, Table } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { RadioButton, RadioButtonGroup, RadioButtonGroupDirection } from "azure-devops-ui/RadioButton";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { TextField } from "azure-devops-ui/TextField";
import { FolderTooLarge, GhError, createBranch, getCommitTree, getRaw, invalidateBrowse, invalidatePrs, listItemsUnder, mutate, pathExistsOn, restSend } from "./githubBrowse";
import { TabBar, Tab, TabSize } from "azure-devops-ui/Tabs";
import { commitRequest, createRefRequest, deleteFolderMessage, deleteTreeRequest, filesUnder, isNotFastForward, updateRefRequest } from "./lib/folderDelete";
import { setEditGuard } from "./hostNav";
import { RefWriteError, type RefWrites } from "./refWrites";
import { actionErrorText } from "./actionStore";
import {
  bytesToBase64, checkUploads, commitOnBranchMutation, defaultMessage, deleteChanges, isStaleHeadError, planCommit, prepareEdited, renameChanges, suggestBranchName, treeLookup, utf8ToBase64, validateCommitForm, validatePath,
  type CommitForm, type CommitPlan, type FileChanges, type WriteContext,
} from "./lib/fileCommit";
import { monacoLanguage } from "./lib/fileKind";
import { needsFolderFetch, type GitTree } from "./lib/tree";
import { isWorkflowPermissionError, WORKFLOW_PERMISSION_TEXT } from "./lib/workflowWrite";

// ---------- the write ----------

export const STALE_TEXT = "The branch has changed since you opened this file, so GitHub refused the commit.";

/** A new branch first when asked, then the commit. Drops the cached trees and PR lists afterwards. Throws RefWriteError with a sentence when GitHub's reason is worth saying in words. */
export async function runCommit(p: { repo: string; repoId: string; plan: CommitPlan; message: { headline: string; body?: string }; changes: FileChanges }): Promise<void> {
  if (p.plan.createFrom) await createBranch(p.repoId, p.plan.branch, p.plan.createFrom);
  try {
    await mutate(commitOnBranchMutation({ repo: p.repo, branch: p.plan.branch, expectedHeadOid: p.plan.expectedHeadOid, message: p.message, changes: p.changes }));
  } catch (e) {
    if (e instanceof GhError && isStaleHeadError(e.detail)) throw new RefWriteError(STALE_TEXT);
    if (e instanceof GhError && isWorkflowPermissionError({ status: e.status, message: e.detail ?? e.apiMessage }, [...p.changes.additions, ...p.changes.deletions].map((c) => c.path))) throw new RefWriteError(WORKFLOW_PERMISSION_TEXT);
    if (p.plan.createFrom) throw new RefWriteError(`Created the branch ${p.plan.branch}, but the commit failed. ${actionErrorText(e)}`);
    throw e;
  } finally {
    invalidateBrowse();
    invalidatePrs();
  }
}

/** Deletes every file under `folder` in one commit through the REST Git data API (lib/folderDelete.ts): a direct commit moves the
 *  branch without force, so a branch that moved since the page loaded is refused as stale; a new branch is created at the commit. */
export async function runFolderDelete(p: { repo: string; tree: GitTree; folder: string; plan: CommitPlan; message: { headline: string; body?: string } }): Promise<void> {
  let items;
  try {
    items = await listItemsUnder(p.repo, p.tree, p.folder);
  } catch (e) {
    if (e instanceof FolderTooLarge) throw new RefWriteError(`${p.folder} has too many files to delete here. Delete it on GitHub or with Git.`);
    throw e;
  }
  const entries = filesUnder(items, p.folder);
  if (!entries.length) throw new RefWriteError(`${p.folder} has no files to delete.`);
  try {
    const head = p.plan.expectedHeadOid;
    const tree = await restSend<{ sha: string }>(deleteTreeRequest(p.repo, await getCommitTree(p.repo, head), entries));
    const commit = await restSend<{ sha: string }>(commitRequest(p.repo, { message: p.message, tree: tree.sha, parent: head }));
    await restSend(p.plan.createFrom ? createRefRequest(p.repo, p.plan.branch, commit.sha) : updateRefRequest(p.repo, p.plan.branch, commit.sha));
  } catch (e) {
    if (e instanceof GhError && e.status === 422 && isNotFastForward(e.apiMessage)) throw new RefWriteError(STALE_TEXT);
    if (e instanceof GhError && isWorkflowPermissionError({ status: e.status, message: e.apiMessage ?? e.detail }, entries.map((x) => x.path))) throw new RefWriteError(WORKFLOW_PERMISSION_TEXT);
    if (e instanceof GhError && e.status === 422 && p.plan.createFrom) throw new RefWriteError(`Could not create the branch ${p.plan.branch}: ${e.apiMessage ?? "GitHub refused it"}.`);
    throw e;
  } finally {
    invalidateBrowse();
    invalidatePrs();
  }
}

// ---------- the Commit dialog ----------

export interface CommitDialogProps {
  title: string;
  /** What the message starts as; it follows this until the user types. */
  defaultMessage: string;
  branch: string;
  /** Existing branch names, for the new-branch name check; undefined while loading. */
  branches: string[] | undefined;
  viewerLogin: string;
  /** Extra form fields above the message (a new path, the files to upload). */
  children?: React.ReactNode;
  /** The extra fields are complete. */
  ready?: boolean;
  /** One line under the title, such as what will be deleted. */
  summary?: React.ReactNode;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  /** The branch moved: the error offers Reload instead of Dismiss. */
  onReload?: () => void;
  commit: (form: CommitForm) => void;
  close: () => void;
  danger?: boolean;
}

export function CommitDialog(p: CommitDialogProps) {
  const [headline, setHeadline] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [mode, setMode] = React.useState<"direct" | "branch">("direct");
  const [branchName, setBranchName] = React.useState("");
  React.useEffect(() => { if (mode === "branch" && !branchName) setBranchName(suggestBranchName(p.viewerLogin, p.branches ?? [])); }, [mode, p.viewerLogin, p.branches]); // eslint-disable-line react-hooks/exhaustive-deps
  const form: CommitForm = { headline: headline ?? p.defaultMessage, body, target: mode === "direct" ? { kind: "direct" } : { kind: "branch", name: branchName } };
  const check = validateCommitForm(form, p.branches ?? []);
  const branchProblem = mode === "branch" && !check.ok && check.field === "branch" ? check.reason : undefined;
  const form$ = React.useRef<HTMLDivElement>(null);
  // The dialog's own autofocus does not take (a closing ⋯ menu hands focus back to its button), so move it to the first field.
  React.useEffect(() => { const t = setTimeout(() => form$.current?.querySelector<HTMLElement>("input")?.focus(), 80); return () => clearTimeout(t); }, []);
  const stale = p.error === STALE_TEXT;
  const ok = check.ok && (p.ready ?? true);
  return (
    <Dialog
      contentSize={ContentSize.Medium}
      titleProps={{ text: p.title }}
      onDismiss={() => !p.busy && p.close()}
      footerButtonProps={[
        { text: "Cancel", onClick: p.close, disabled: p.busy },
        { text: mode === "branch" ? "Commit and create pull request" : "Commit", primary: true, danger: p.danger, disabled: !ok || p.busy, onClick: () => p.commit(form) },
      ]}
    >
      <div ref={form$} className="gh-dialog-form gh-commit-form flex-column">
        {p.error && (
          <MessageCard
            severity={MessageCardSeverity.Error}
            onDismiss={stale ? undefined : p.clearError}
            buttonProps={stale && p.onReload ? [{ text: "Reload the latest version", onClick: p.onReload }] : undefined}
          >
            {stale ? `${STALE_TEXT} Reloading loses your edits, so copy them first if you need them. Or commit to a new branch instead.` : p.error}
          </MessageCard>
        )}
        {p.summary}
        {p.children}
        <FormItem label="Commit message" required error={check.ok === false && check.field === "headline" && headline !== null} message={check.ok === false && check.field === "headline" && headline !== null ? check.reason : undefined}>
          <TextField value={form.headline} onChange={(_e, v) => setHeadline(v)} required autoFocus ariaLabel="Commit message" spellCheck />
        </FormItem>
        <FormItem label="Description">
          <TextField value={body} onChange={(_e, v) => setBody(v)} multiline rows={3} placeholder="Add an optional extended description" ariaLabel="Commit description" />
        </FormItem>
        <RadioButtonGroup className="gh-commit-target" text="Commit to" direction={RadioButtonGroupDirection.Vertical} selectedButtonId={mode} onSelect={(id) => setMode(id as "direct" | "branch")}>
          <RadioButton id="direct" text={`Commit directly to ${p.branch}`} />
          <RadioButton id="branch" text="Create a new branch for this commit and start a pull request" />
        </RadioButtonGroup>
        {mode === "branch" && (
          <FormItem label="New branch name" required error={!!branchProblem} message={branchProblem}>
            <TextField value={branchName} onChange={(_e, v) => setBranchName(v)} required ariaLabel="New branch name" spellCheck={false} />
          </FormItem>
        )}
        {p.busy && <Spinner size={SpinnerSize.small} label="Committing" ariaLabel="Committing" />}
      </div>
    </Dialog>
  );
}

// ---------- the editable pane ----------

export interface EditPaneProps {
  /** Browser.loadMonaco, passed in so this file does not import Browser (which imports this one). */
  loadMonaco: () => Promise<typeof import("./monacoChunk")>;
  /** The file name, or null for a new file, whose path is typed in the pane. */
  name: string | null;
  /** Folder a new file goes in ("" for the root); a prefix for the path field. */
  dir: string;
  initial: string;
  dark: boolean;
  /** The path typed for a new file, and what is wrong with it. */
  path: string;
  setPath: (p: string) => void;
  pathProblem: string | null;
  busy: boolean;
  /** The file being edited or drafted, for the Discard dialog. */
  target: string;
  setText: (t: string) => void;
  commit: () => void;
  cancel: () => void;
  /** Markdown only: renders the text as it stands for the Preview tab. */
  renderPreview?: (text: string) => React.ReactNode;
}

/** Monaco, editable, with Commit and Cancel above it. The text lives in the editor; `setText` reports each change so the parent knows it to commit. */
export function EditPane(p: EditPaneProps) {
  const { loadMonaco } = p;
  const box = React.useRef<HTMLDivElement>(null);
  const ed = React.useRef<{ setLanguage(l: string): void; dispose(): void } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");
  const text = React.useRef(p.initial);
  const isNew = p.name === null;
  const label = isNew ? "New file contents" : `Editing ${p.name}`;
  React.useEffect(() => {
    let dead = false;
    loadMonaco()
      .then((m) => {
        if (dead || !box.current) return;
        const e = m.createEditor(box.current, p.initial, monacoLanguage(p.name ?? p.path), p.dark, label, () => { const t = e.editor.getValue(); text.current = t; p.setText(t); setDirty(t !== p.initial); });
        text.current = p.initial;
        p.setText(p.initial);
        ed.current = { setLanguage: (l) => m.setLanguage(e.editor, l), dispose: e.dispose };
      })
      .catch(() => !dead && setFailed(true));
    return () => { dead = true; ed.current?.dispose(); ed.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per file; the path only changes its language, below
  }, [p.initial, p.name]);
  React.useEffect(() => { if (isNew) ed.current?.setLanguage(monacoLanguage(p.path)); }, [p.path, isNew]);
  React.useEffect(() => { void loadMonaco().then((m) => m.setTheme(p.dark)); }, [p.dark]);
  // The page would close with the edits in it.
  React.useEffect(() => {
    if (!(dirty || isNew)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, isNew]);
  // Any in-app navigation away (tree, breadcrumb, branch, find, tab) and back/forward asks first, through hostNav's guard.
  const [pending, setPending] = React.useState<{ proceed: () => void } | null>(null);
  React.useEffect(() => {
    setEditGuard({ dirty: dirty || isNew, path: p.target, ask: (proceed) => setPending({ proceed }), discard: p.cancel });
    return () => setEditGuard(null);
  }, [dirty, isNew, p.target, p.cancel]);
  const cancel = () => { if (!dirty || window.confirm("Discard your changes?")) p.cancel(); };
  const canCommit = isNew ? !p.pathProblem : dirty;
  return (
    <div className="gh-edit flex-column">
      <div className="gh-edit-bar flex-row flex-center">
        {p.renderPreview && (
          <TabBar ariaLabel="Editor view" className="gh-edit-tabs" selectedTabId={`md-${mode}`} onSelectedTabChanged={(id) => setMode(id === "md-preview" ? "preview" : "edit")} tabSize={TabSize.Compact} disableSticky>
            <Tab id="md-edit" name="Edit" />
            <Tab id="md-preview" name="Preview" />
          </TabBar>
        )}
        {isNew && (
          <FormItem className="gh-edit-path flex-grow" message={p.pathProblem ?? undefined} error={!!p.pathProblem && p.path.trim() !== "" && p.path !== (p.dir ? `${p.dir}/` : "")}>
            <TextField value={p.path} onChange={(_e, v) => p.setPath(v)} ariaLabel="File path. Use / to put it in a folder" placeholder="Name the file, for example docs/notes.md" autoFocus spellCheck={false} required />
          </FormItem>
        )}
        <span className="flex-grow" />
        <ButtonGroup>
          <Button text="Cancel" onClick={cancel} disabled={p.busy} />
          <Button text="Commit…" primary disabled={!canCommit || p.busy} onClick={p.commit} />
        </ButtonGroup>
      </div>
      {pending && (
        <Dialog
          titleProps={{ text: `Discard your changes to ${p.target}?` }}
          onDismiss={() => setPending(null)}
          footerButtonProps={[
            { text: "Keep editing", onClick: () => setPending(null) },
            { text: "Discard changes", primary: true, onClick: () => { const go = pending.proceed; setPending(null); go(); } },
          ]}
        >
          Your edits have not been committed and will be lost.
        </Dialog>
      )}
      {failed ? (
        <MessageCard severity={MessageCardSeverity.Error}>The editor could not be loaded.</MessageCard>
      ) : (
        <>
          {/* The editor stays mounted (hidden) while previewing, so its text, undo history and scroll position survive. */}
          <div className="gh-edit-card" style={mode === "preview" ? { display: "none" } : undefined}><div ref={box} className="gh-code gh-code-edit" /></div>
          {mode === "preview" && p.renderPreview?.(text.current)}
        </>
      )}
    </div>
  );
}

// ---------- uploads ----------

/** A file picker with the picked files listed. The <input type=file> is native: azure-devops-ui has no file picker. */
export function UploadPicker({ onPick, files, rejected, replaces }: { onPick: (files: File[]) => void; files: { name: string; size: number }[]; rejected: { name: string; reason: string }[]; replaces: number }) {
  const [labelId, setLabelId] = React.useState<string>();
  const provider = React.useMemo(() => new ArrayItemProvider(files), [files]);
  const cols = React.useMemo<ITableColumn<{ name: string; size: number }>[]>(() => [
    { id: "name", name: "Name", width: -100, renderCell: (_r, columnIndex, tableColumn, f) => <SimpleTableCell key="name" columnIndex={columnIndex} tableColumn={tableColumn}><span className="text-ellipsis">{f.name}</span></SimpleTableCell> },
    { id: "size", name: "Size", width: 90, renderCell: (_r, columnIndex, tableColumn, f) => <SimpleTableCell key="size" columnIndex={columnIndex} tableColumn={tableColumn}><span className="secondary-text">{formatSize(f.size)}</span></SimpleTableCell> },
  ], []);
  return (
    <div className="gh-upload flex-column">
      <FormItem label="Files to upload" message="Up to 10 MB for each file and 20 MB in all." emitGeneratedLabelId={setLabelId}>
        <input className="gh-upload-input" type="file" multiple aria-labelledby={labelId} onChange={(e) => { onPick(Array.from(e.target.files ?? [])); }} />
      </FormItem>
      {rejected.map((r) => <MessageCard key={r.name + r.reason} severity={MessageCardSeverity.Warning}>{r.reason}</MessageCard>)}
      {files.length > 0 && <Table<{ name: string; size: number }> className="gh-upload-list" ariaLabel="Files to upload" role="table" columns={cols} itemProvider={provider} />}
      {replaces > 0 && <MessageCard severity={MessageCardSeverity.Info}>{replaces === 1 ? "One file replaces a file with the same name." : `${replaces} files replace files with the same name.`}</MessageCard>}
    </div>
  );
}

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- the dialogs ----------

export type WriteDialog =
  | { kind: "edit"; path: string; text: string; original: string; bom: boolean }
  | { kind: "new"; path: string; text: string }
  | { kind: "upload"; dir: string }
  | { kind: "rename"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "deleteFolder"; path: string };

export interface WriteDialogsProps {
  dialog: WriteDialog;
  repo: string;
  branch: string;
  write: WriteContext;
  tree: GitTree;
  branches: string[] | undefined;
  viewerLogin: string;
  writes: RefWrites;
  close: () => void;
  /** The write succeeded. `goto` is the path to show next (a renamed file's new path, the folder of a deleted one). */
  done: (plan: CommitPlan, goto?: string) => void;
  reload: () => void;
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const parentDir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

type Common = Omit<CommitDialogProps, "title" | "defaultMessage" | "commit">;
type Commit = (form: CommitForm, build: () => Promise<FileChanges>, goto?: string, guard?: () => Promise<void>) => void;

/** The Commit dialog for whichever write is open, with that write's own fields and the changes it commits. */
export function WriteDialogs(p: WriteDialogsProps) {
  const { dialog, repo, write, tree, writes } = p;
  const lookup = React.useMemo(() => treeLookup(tree), [tree]);
  // A truncated tree does not list everything, so the sync lookup can miss a path; ask GitHub before replacing it.
  const guardNew = async (path: string) => { if (needsFolderFetch(tree, "") && (await pathExistsOn(repo, tree, path))) throw new RefWriteError(`${path} already exists.`); };
  const commit: Commit = (form, build, goto, guard) => {
    const v = validateCommitForm(form, p.branches ?? []);
    if (!v.ok || !write.headOid) return;
    const plan = planCommit(form.target, p.branch, write.headOid);
    void writes.run(async () => {
      await guard?.();
      await runCommit({ repo, repoId: write.repoId, plan, message: v.message, changes: await build() });
    }, () => p.done(plan, goto));
  };
  const common: Common = { branch: p.branch, branches: p.branches, viewerLogin: p.viewerLogin, busy: writes.busy, error: writes.error, clearError: writes.clearError, close: p.close, onReload: p.reload };

  if (dialog.kind === "edit")
    return <CommitDialog {...common} title="Commit changes" defaultMessage={defaultMessage({ kind: "edit", path: dialog.path })} commit={(f) => commit(f, async () => ({ additions: [{ path: dialog.path, contents: utf8ToBase64(prepareEdited(dialog.text, { original: dialog.original, bom: dialog.bom })) }], deletions: [] }))} />;
  if (dialog.kind === "new")
    return <CommitDialog {...common} title="Commit new file" defaultMessage={defaultMessage({ kind: "create", path: dialog.path.trim() })} commit={(f) => commit(f, async () => ({ additions: [{ path: dialog.path.trim(), contents: utf8ToBase64(prepareEdited(dialog.text, {})) }], deletions: [] }), dialog.path.trim(), () => guardNew(dialog.path.trim()))} />;
  if (dialog.kind === "delete")
    return (
      <CommitDialog
        {...common}
        danger
        title="Delete file"
        summary={<div>Delete <strong>{dialog.path}</strong> from {p.branch}?</div>}
        defaultMessage={defaultMessage({ kind: "delete", path: dialog.path })}
        commit={(f) => commit(f, async () => deleteChanges(dialog.path), parentDir(dialog.path))}
      />
    );
  if (dialog.kind === "deleteFolder") {
    const folder = dialog.path;
    const commitFolder = (form: CommitForm) => {
      const v = validateCommitForm(form, p.branches ?? []);
      if (!v.ok || !write.headOid) return;
      const plan = planCommit(form.target, p.branch, write.headOid);
      void writes.run(() => runFolderDelete({ repo, tree, folder, plan, message: v.message }), () => p.done(plan, parentDir(folder)));
    };
    return (
      <CommitDialog
        {...common}
        danger
        title="Delete folder"
        summary={<div>Delete <strong>{folder}</strong> and everything in it from {p.branch}?</div>}
        defaultMessage={deleteFolderMessage(folder)}
        commit={commitFolder}
      />
    );
  }
  if (dialog.kind === "rename") return <RenameDialog repo={repo} branch={p.branch} common={common} commit={commit} guardNew={guardNew} lookup={lookup} path={dialog.path} />;
  return <UploadDialog common={common} commit={commit} lookup={lookup} dir={dialog.dir} />;
}

function RenameDialog({ repo, branch, common, commit, guardNew, lookup, path }: { repo: string; branch: string; common: Common; commit: Commit; guardNew: (p: string) => Promise<void>; lookup: ReturnType<typeof treeLookup>; path: string }) {
  const [to, setTo] = React.useState(path);
  const problem = to === path ? "Enter a different path." : validatePath(to, lookup);
  const next = to.trim();
  return (
    <CommitDialog {...common} title="Rename file" ready={!problem} defaultMessage={defaultMessage({ kind: "rename", from: path, to: next })}
      commit={(f) => commit(f, async () => renameChanges(path, next, bytesToBase64(new Uint8Array(await getRaw(repo, branch, path)))), next, () => guardNew(next))}>
      <FormItem label="New path" required error={!!problem && to !== path} message={to !== path ? problem ?? undefined : `Use / to move ${baseName(path)} into a folder.`}>
        <TextField value={to} onChange={(_e, v) => setTo(v)} required autoFocus ariaLabel={`New path for ${baseName(path)}`} spellCheck={false} />
      </FormItem>
    </CommitDialog>
  );
}

function UploadDialog({ common, commit, lookup, dir }: { common: Common; commit: Commit; lookup: ReturnType<typeof treeLookup>; dir: string }) {
  const [picked, setPicked] = React.useState<File[]>([]);
  const check = React.useMemo(() => checkUploads(picked.map((f) => ({ name: f.name, size: f.size })), dir, (x) => lookup(x) === "file"), [picked, dir, lookup]);
  const byName = new Map(picked.map((f) => [f.name, f]));
  return (
    <CommitDialog {...common} title={dir ? `Upload files to ${dir}` : "Upload files"} ready={check.accepted.length > 0} defaultMessage={defaultMessage({ kind: "upload", paths: check.accepted.map((a) => a.path) })}
      commit={(f) => commit(f, async () => ({ additions: await Promise.all(check.accepted.map(async (a) => ({ path: a.path, contents: bytesToBase64(new Uint8Array(await byName.get(a.name)!.arrayBuffer())) }))), deletions: [] }), dir)}>
      <UploadPicker onPick={setPicked} files={check.accepted} rejected={check.rejected} replaces={check.accepted.filter((a) => a.replaces).length} />
    </CommitDialog>
  );
}
