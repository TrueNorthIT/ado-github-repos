// Cherry-pick and Revert dialogs (native ADO: a commit's ⋯ menu, and a completed pull request's ⋯ menu). The form asks for the target
// branch and a new topic branch; while it runs it shows the step; when done it offers "Create pull request" (our New pull request page,
// source = the topic branch, target = the target) and "View branch". The writes are lib/cherryPick.ts runPick, over REST.
import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { getCanPush, getGitCommit, getPrPickSource, listBranches, runCherryPick } from "./githubBrowse";
import {
  KIND_LABEL, PickError, STEP_TEXT, defaultTopicBranch, pickMessage, pickRange, randomSuffix, shortSha, subjectOf, tempBranchName,
  type GitCommit, type GitPerson, type PickKind, type PickStep,
} from "./lib/cherryPick";
import { validateRefName } from "./lib/refName";
import { serializeNewPr } from "./lib/newPrHash";
import { RefWriteError, useRefWrites } from "./refWrites";
import { openInHub, useHubHref } from "./repoHref";

/** What is being cherry-picked or reverted: one commit, or a merged pull request (cherry-pick only; Revert there is GitHub's own). */
export type PickSource = { type: "commit"; sha: string } | { type: "pr"; number: number };

interface Loaded {
  branches: string[];
  canPush: boolean;
  /** A commit's own data, for its message, author and parents. */
  commit?: GitCommit;
  /** A pull request's target, change and message. */
  pr?: { target: string; range: { from: string; to: string }; message: string; author?: GitPerson; mergeSha: string };
}

const NONE: string[] = [];

export function CherryPickDialog({ repo, kind, source, defaultTarget, close }: { repo: string; kind: PickKind; source: PickSource; defaultTarget?: string; close: () => void }) {
  const writes = useRefWrites();
  const href = useHubHref();
  const [data, setData] = React.useState<Loaded | { failed: string }>();
  const [target, setTarget] = React.useState(defaultTarget ?? "");
  const [topic, setTopic] = React.useState<string>();
  const [mainline, setMainline] = React.useState(1);
  const [step, setStep] = React.useState<PickStep>();
  const [done, setDone] = React.useState<{ branch: string; target: string }>();
  const targetSel = React.useRef(new DropdownSelection());
  const parentSel = React.useRef(new DropdownSelection());

  React.useEffect(() => {
    let dead = false;
    const src = source.type === "commit" ? getGitCommit(repo, source.sha).then((commit) => ({ commit })) : getPrPickSource(repo, source.number).then((pr) => ({ pr }));
    Promise.all([listBranches(repo), getCanPush(repo), src]).then(
      ([branches, canPush, s]) => {
        if (dead) return;
        const t = (s as Loaded).pr?.target ?? (defaultTarget && branches.includes(defaultTarget) ? defaultTarget : branches[0] ?? "");
        setTarget(t);
        setData({ branches, canPush, ...s });
      },
      (e) => !dead && setData({ failed: e instanceof PickError ? e.message : "Could not read the commit and branches from GitHub. Try again." })
    );
    return () => { dead = true; };
  }, [repo, source.type === "commit" ? source.sha : source.number]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = data && !("failed" in data) ? data : undefined;
  const branches = loaded?.branches ?? NONE;
  React.useEffect(() => {
    const i = branches.indexOf(target);
    if (i >= 0) targetSel.current.select(i);
  }, [branches, target]);

  const parentCount = loaded?.commit?.parents.length ?? 0;
  React.useEffect(() => {
    if (parentCount > 1) parentSel.current.select(mainline - 1);
  }, [parentCount, mainline]);

  const sha = source.type === "commit" ? source.sha : loaded?.pr?.mergeSha ?? "";
  const label = source.type === "commit" ? shortSha(source.sha) : `pr-${source.number}`;
  const suggested = target ? defaultTopicBranch(kind, target, label, branches) : "";
  const name = topic ?? suggested;
  const check = validateRefName(name, branches);
  const isMerge = (loaded?.commit?.parents.length ?? 0) > 1;
  const verb = KIND_LABEL[kind];
  const what = source.type === "commit" ? `commit ${shortSha(source.sha)}` : `pull request ${source.number}`;

  let rangeError: string | undefined;
  let range: { from: string; to: string } | undefined;
  try {
    range = loaded?.pr?.range ?? (loaded?.commit ? pickRange(kind, loaded.commit, isMerge ? mainline : undefined) : undefined);
  } catch (e) {
    rangeError = e instanceof PickError ? e.message : String(e);
  }

  const start = () => {
    if (!loaded || !range) return;
    const message = loaded.pr?.message ?? pickMessage(kind, loaded.commit!);
    const author = loaded.pr ? loaded.pr.author : kind === "cherryPick" ? loaded.commit!.author : undefined;
    const p = { repo, kind, range, message, author, target, topic: name, temp: tempBranchName(kind, sha, randomSuffix()), onStep: setStep };
    void writes.run(
      () => runCherryPick(p).catch((e) => { throw e instanceof PickError ? new RefWriteError(e.message) : e; }).finally(() => setStep(undefined)),
      () => setDone({ branch: name, target })
    );
  };

  const prHash = done ? serializeNewPr({ repo, source: done.branch, target: done.target }) : "";
  const running = writes.busy;
  const canStart = !!loaded && loaded.canPush && !!range && !!target && check.ok && !running;
  const nameMessage = name !== "" && !check.ok ? check.reason : undefined;

  const footer = done
    ? [
        { text: "Close", onClick: close },
        { text: "View branch", href: href("files", { repo, ref: done.branch }), onClick: (e: React.MouseEvent) => (openInHub("files", { repo, ref: done.branch })(e), close()) },
        { text: "Create pull request", primary: true, href: href("prs", prHash), onClick: (e: React.MouseEvent) => (openInHub("prs", prHash)(e), close()) },
      ]
    : [
        { text: "Cancel", onClick: close, disabled: running },
        { text: verb, primary: true, disabled: !canStart, onClick: start },
      ];

  return (
    <Dialog titleProps={{ text: `${verb} ${what}` }} onDismiss={running ? () => {} : close} footerButtonProps={footer as any}>
      <div className="gh-dialog-form flex-column">
        {done ? (
          <MessageCard severity={MessageCardSeverity.Info} className="gh-pick-done">
            <span>{kind === "revert" ? "Reverted" : "Cherry-picked"} {what} into the new branch <strong>{done.branch}</strong>, based on <strong>{done.target}</strong>. Create a pull request to merge it into {done.target}.</span>
          </MessageCard>
        ) : !data ? (
          <Spinner size={SpinnerSize.medium} label="Loading" />
        ) : "failed" in data ? (
          <MessageCard severity={MessageCardSeverity.Error}>{data.failed}</MessageCard>
        ) : (
          <>
            {!data.canPush && <MessageCard severity={MessageCardSeverity.Warning}>You need write access to this repository to {kind === "revert" ? "revert" : "cherry-pick"} into a new branch.</MessageCard>}
            {writes.error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={writes.clearError}>{writes.error}</MessageCard>}
            {rangeError && !isMerge && <MessageCard severity={MessageCardSeverity.Warning}>{rangeError}</MessageCard>}
            <div className="secondary-text">
              {kind === "revert" ? "Creates a new branch with a commit that undoes" : "Creates a new branch with the changes from"} {what}
              {data.commit ? <>: <strong>{subjectOf(data.commit.message)}</strong></> : null}. You can then open a pull request into the target branch.
            </div>
            <FormItem label="Target branch">
              <Dropdown
                ariaLabel="Target branch" items={branches.map((b) => ({ id: b, text: b }))} selection={targetSel.current} disabled={running}
                showFilterBox filterPlaceholderText="Find a branch" onSelect={(_e, i) => setTarget(i.id)}
              />
            </FormItem>
            {isMerge && (
              <FormItem label="Mainline parent" message={`This is a merge commit. The ${kind === "revert" ? "revert undoes" : "cherry-pick applies"} its changes relative to the parent you choose.`}>
                <Dropdown
                  ariaLabel="Mainline parent" selection={parentSel.current} disabled={running}
                  items={data.commit!.parents.map((p, i) => ({ id: String(i + 1), text: `Parent ${i + 1} (${shortSha(p)})` }))}
                  onSelect={(_e, i) => setMainline(Number(i.id))}
                />
              </FormItem>
            )}
            <FormItem label="Topic branch name" required error={!!nameMessage} message={nameMessage}>
              <TextField value={name} onChange={(_e, v) => setTopic(v)} disabled={running} required ariaLabel="Topic branch name" spellCheck={false} width={TextFieldWidth.auto} />
            </FormItem>
            {step && <Spinner size={SpinnerSize.small} label={STEP_TEXT[step]} />}
          </>
        )}
      </div>
    </Dialog>
  );
}
