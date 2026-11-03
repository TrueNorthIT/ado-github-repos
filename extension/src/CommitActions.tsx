// The commit ⋯ menu's writes (native Commits: New branch, Create tag): the dialogs, the serialised writes and the notice, shared by the commit list and the commit page.
import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { IMenuItem } from "azure-devops-ui/Menu";
import { NewBranchDialog, NewTagDialog } from "./RefDialogs";
import { createBranch, createTag, listAllBranches, listAllTags } from "./githubBrowse";
import { useRefWrites } from "./refWrites";

type Open = { kind: "branch" | "tag"; sha: string };
const NO_NAMES: string[] = [];

/** `menu(sha)` gives the two ⋯ items for a commit; `ui` holds the dialogs and messages and is rendered once by the page. */
export function useCommitActions(repo: string, signedIn: boolean): { menu: (sha: string) => IMenuItem[]; ui: React.ReactNode } {
  const writes = useRefWrites();
  const [open, setOpen] = React.useState<Open | null>(null);
  // What the dialogs need to check a name and to write: fetched when a dialog first opens, per repository.
  const [info, setInfo] = React.useState<{ repoId: string; branches?: string[]; tags?: string[] }>();
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => setInfo(undefined), [repo]);
  React.useEffect(() => {
    if (!open || info?.[open.kind === "branch" ? "branches" : "tags"]) return;
    let dead = false;
    const merge = (patch: { repoId: string; branches?: string[]; tags?: string[] }) => !dead && setInfo((i) => ({ ...i, ...patch }));
    if (open.kind === "branch") listAllBranches(repo).then((v) => merge({ repoId: v.repoId, branches: v.branches.map((b) => b.name) }), () => {});
    else listAllTags(repo).then((v) => merge({ repoId: v.repoId, tags: v.tags.map((t) => t.name) }), () => {});
    return () => { dead = true; };
  }, [open, info, repo, signedIn]);

  const show = (kind: Open["kind"], sha: string) => { writes.clearError(); setNotice(null); setOpen({ kind, sha }); };
  const menu = React.useCallback((sha: string): IMenuItem[] => [
    { id: "branch", text: "New branch", iconProps: { iconName: "BranchFork2" }, disabled: writes.busy, onActivate: () => show("branch", sha) },
    { id: "tag", text: "Create tag", iconProps: { iconName: "Tag" }, disabled: writes.busy, onActivate: () => show("tag", sha) },
  ], [writes.busy]); // eslint-disable-line react-hooks/exhaustive-deps -- show only uses setters

  const close = () => { if (!writes.busy) { setOpen(null); writes.clearError(); } };
  const short = open?.sha.slice(0, 8) ?? "";
  const ui = (
    <>
      {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
      {open?.kind === "branch" && (
        <NewBranchDialog
          branches={info?.branches ?? NO_NAMES} existing={info?.branches ?? NO_NAMES} defaultBase="" fixedBase={`Commit ${short}`}
          busy={writes.busy || !info?.branches} error={writes.error} clearError={writes.clearError} close={close}
          create={(name) => void writes.run(() => createBranch(info!.repoId, name, open.sha), () => { setOpen(null); setNotice(`Created branch ${name} from commit ${short}.`); })}
        />
      )}
      {open?.kind === "tag" && (
        <NewTagDialog
          branches={NO_NAMES} existing={info?.tags ?? NO_NAMES} defaultBase="" presetSha={open.sha}
          busy={writes.busy || !info?.tags} error={writes.error} clearError={writes.clearError} close={close}
          create={(p) => void writes.run(() => createTag(repo, info!.repoId, { name: p.name, oid: open.sha, message: p.message }), () => { setOpen(null); setNotice(`Created tag ${p.name} on commit ${short}.`); })}
        />
      )}
    </>
  );
  return { menu, ui };
}
