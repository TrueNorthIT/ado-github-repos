// The commit ⋯ menu's writes (native Commits: New branch, Create tag): the dialogs, the serialised writes and the notice, shared by the commit list and the commit page.
import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { IMenuItem } from "azure-devops-ui/Menu";
import { NewBranchDialog, NewTagDialog } from "./RefDialogs";
import { createBranch, createTag, listAllBranches, listAllTags } from "./githubBrowse";
import { useRefWrites } from "./refWrites";
import { CherryPickDialog } from "./CherryPick";
import { getCanPush } from "./githubBrowse";
import { useGh } from "./queryClient";
import type { PickKind } from "./lib/cherryPick";

type Open = { kind: "branch" | "tag"; sha: string } | { kind: PickKind; sha: string };
const NO_NAMES: string[] = [];

/** `menu(sha)` gives the ⋯ items for a commit (New branch, Create tag, Cherry-pick, Revert); `ui` holds the dialogs and messages and is
 *  rendered once by the page. `branch` is the branch being browsed: Cherry-pick and Revert default their target to it. */
export function useCommitActions(repo: string, signedIn: boolean, branch?: string): { menu: (sha: string) => IMenuItem[]; ui: React.ReactNode } {
  const writes = useRefWrites();
  const [open, setOpen] = React.useState<Open | null>(null);
  // What the dialogs need to check a name and to write: fetched when a dialog first opens, per repository.
  const [info, setInfo] = React.useState<{ repoId: string; branches?: string[]; tags?: string[] }>();
  const [notice, setNotice] = React.useState<string | null>(null);

  // Cherry-pick and Revert write branches: disabled for a viewer without push access (GET /repos permissions.push, REST).
  const push = useGh(signedIn ? ["refs", "canPush", repo] : null, () => getCanPush(repo), { persist: true });
  const canPush = signedIn && push.t === "ready" ? push.v : undefined;
  React.useEffect(() => setInfo(undefined), [repo]);
  React.useEffect(() => {
    if (!open || (open.kind !== "branch" && open.kind !== "tag") || info?.[open.kind === "branch" ? "branches" : "tags"]) return;
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
    { id: "cherryPick", text: "Cherry-pick", iconProps: { iconName: "BranchCommit" }, disabled: writes.busy || canPush === false, onActivate: () => show("cherryPick", sha) },
    { id: "revert", text: "Revert", iconProps: { iconName: "Undo" }, disabled: writes.busy || canPush === false, onActivate: () => show("revert", sha) },
  ], [writes.busy, canPush]); // eslint-disable-line react-hooks/exhaustive-deps -- show only uses setters

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
      {(open?.kind === "cherryPick" || open?.kind === "revert") && (
        <CherryPickDialog repo={repo} kind={open.kind} source={{ type: "commit", sha: open.sha }} defaultTarget={branch} close={() => setOpen(null)} />
      )}
    </>
  );
  return { menu, ui };
}
