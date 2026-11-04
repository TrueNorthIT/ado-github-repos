// The New pull request page (batch 5): branches, title, description, the right-hand panels, Create, and the Files / Commits preview.
// The logic is in lib/newPr.ts, prTemplates.ts, branchWorkItems.ts, createPrPlan.ts and newPrHash.ts; this file draws it and wires it to the GitHub data layer.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { SplitButton } from "azure-devops-ui/SplitButton";
import { Table, TwoLineTableCell, type ITableColumn } from "azure-devops-ui/Table";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ErrorView, hubClick } from "./Browser";
import { CommentBox } from "./CommentBox";
import { FilesBar } from "./PrFilesBar";
import { FilesView } from "./PrFiles";
import { LabelPill, LabelsAdd, MilestoneAdd, PeopleAdd, ProjectsAdd, RemoveButton, WorkItemsAdd, addItem, dueText } from "./PrEdit";
import { Section, Well, WorkItemRow, useWorkItems } from "./PrPage";
import { BranchBar, useDefaultBranch } from "./RepoHub";
import { actionErrorText, actionStore } from "./actionStore";
import { getCompareFiles, getForkNewPrCompare, getNewPrCompare, getPrTemplates, getViewerLogin, invalidatePrs, listForks, mutate } from "./githubBrowse";
import { applySourceRepo, type Fork } from "./lib/forks";
import { patchHash, useHashExtras } from "./hostNav";
import { newPrWorkItemIds, prefillWorkItems } from "./lib/branchWorkItems";
import type { BrowseState } from "./lib/browseState";
import { executeCreatePlan, planCreatePr } from "./lib/createPrPlan";
import type { LabelOption } from "./lib/labels";
import { CHECKING_MESSAGE, NO_SOURCE_MESSAGE, NO_TARGET_MESSAGE, NO_TITLE_MESSAGE, VIEW_EXISTING_LABEL, createBlockers, defaultBranches, defaultTitle, initialDescription, type NewPrCompare } from "./lib/newPr";
import { applyNewPr, existingPrHash, type NewPrHashState } from "./lib/newPrHash";
import type { MergeMethod } from "./lib/actionsQuery";
import type { MilestoneOption } from "./lib/milestones";
import { MAX_TITLE_LENGTH, removeWorkItemFromBody } from "./lib/prEdit";
import type { Candidate } from "./lib/reviewerSearch";
import { findWorkItemIds } from "./lib/workItems";
import { watchTheme } from "./theme";
import "./browser.css";

// ---------- a small loader keyed by what it loads, so a stale answer is never shown for the next pair ----------

type Load<T> = { t: "idle" } | { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };

function useLoad<T>(key: string | null, run: () => Promise<T>, reload = 0): Load<T> {
  const [s, setS] = React.useState<{ key: string; r: Load<T> }>();
  React.useEffect(() => {
    if (key === null) return;
    let dead = false;
    setS({ key, r: { t: "loading" } });
    run().then((v) => !dead && setS({ key, r: { t: "ready", v } }), (err) => !dead && setS({ key, r: { t: "error", err } }));
    return () => { dead = true; };
  }, [key, reload]); // eslint-disable-line react-hooks/exhaustive-deps -- `run` is rebuilt every render; `key` says what it loads
  if (key === null) return { t: "idle" };
  return s?.key === key ? s.r : { t: "loading" };
}

const METHODS: { id: MergeMethod; text: string }[] = [{ id: "SQUASH", text: "Squash commit" }, { id: "MERGE", text: "Merge commit" }, { id: "REBASE", text: "Rebase and fast-forward" }];
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// ---------- the preview under the form ----------

export function FilesPreview({ repo, base, head, headOid, signIn, busy }: { repo: string; base: string; head: string; headOid: string; signIn: () => void; busy: boolean }) {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  const [reload, setReload] = React.useState(0);
  const [selected, setSelected] = React.useState<string>();
  const [sideBySide, setSideBySide] = React.useState(false);
  const [ws, setWs] = React.useState(false);
  const r = useLoad(`${repo}|${base}|${head}`, () => getCompareFiles(repo, base, head), reload);
  if (r.t === "loading" || r.t === "idle") return <div className="gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading changed files" /></div>;
  if (r.t === "error") return <ErrorView err={r.err} signIn={signIn} busy={busy} retry={() => setReload((n) => n + 1)} subject="compare these branches" permission="Contents" />;
  const { files, mergeBase } = r.v;
  const bar = (p: { shown: number }) => <FilesBar count={files.length} shown={p.shown} sideBySide={sideBySide} setSideBySide={setSideBySide} ignoreWhitespace={ws} setIgnoreWhitespace={setWs} />;
  return (
    <FilesView
      files={files}
      repo={repo}
      ctx={{ baseSha: mergeBase, headSha: headOid }}
      selected={selected}
      select={setSelected}
      dark={dark}
      sideBySide={sideBySide}
      ignoreWhitespace={ws}
      bar={bar}
    />
  );
}

function CommitsPreview({ repo, compare }: { repo: string; compare: NewPrCompare }) {
  const cols = React.useMemo<ITableColumn<NewPrCompare["commits"][number]>[]>(() => [{
    id: "commit",
    width: -100,
    renderCell: (_r, columnIndex, tableColumn, c) => (
      <TwoLineTableCell
        key="commit"
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        line1={<span className="gh-pr-commit-title commit-title font-weight-semibold text-ellipsis">{c.subject}</span>}
        line2={<Link className="monospaced-xs secondary-text" href={`https://github.com/${repo}/commit/${c.oid}`} target="_blank" rel="noopener noreferrer" subtle ariaLabel={`Commit ${c.oid.slice(0, 7)} on GitHub`}>{c.oid.slice(0, 7)}</Link>}
      />
    ),
  }], [repo]);
  const provider = React.useMemo(() => new ArrayItemProvider(compare.commits), [compare]);
  return (
    <>
      <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
        <Table<NewPrCompare["commits"][number]> ariaLabel="Commits" role="table" columns={cols} itemProvider={provider} showHeader={false} spacerWidth={8} />
      </Card>
      {compare.commitCount > compare.commits.length && <div className="secondary-text body-s gh-np-note">Showing the first {compare.commits.length} of {compare.commitCount} commits.</div>}
    </>
  );
}

// ---------- the page ----------

export interface NewPullRequestProps {
  repo: string;
  entry: NewPrHashState;
  go: (s: BrowseState, replace?: boolean | "ifEmpty") => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
}

const person = (c: Candidate) => c.name || c.login;

export function NewPullRequest({ repo, entry, go, signedIn, signIn, busy }: NewPullRequestProps) {
  const def = useDefaultBranch(repo);
  const [source, setSource] = React.useState<string | null>(entry.source ?? null);
  const [target, setTarget] = React.useState<string | null>(entry.target ?? null);
  // Batch H: the source branch may live in a fork of this repository (`sourceRepo` in the hash); null is this repository.
  const { sourceRepo: hashSourceRepo } = useHashExtras();
  const [headRepo, setHeadRepo] = React.useState<string | null>(hashSourceRepo && hashSourceRepo.toLowerCase() !== repo.toLowerCase() ? hashSourceRepo : null);
  const forksLoad = useLoad(signedIn ? `forks|${repo}` : null, () => listForks(repo).catch(() => [] as Fork[]));
  const forks = forksLoad.t === "ready" ? forksLoad.v : [];
  const fork = headRepo ? forks.find((f) => f.fullName.toLowerCase() === headRepo.toLowerCase()) : undefined;
  React.useEffect(() => {
    if (target === null && def.defaultBranch) setTarget(defaultBranches({ defaultBranch: def.defaultBranch, entrySource: source }).target);
  }, [def.defaultBranch]); // eslint-disable-line react-hooks/exhaustive-deps -- only fills the default in
  // Keep the pair in the address (no history entry), so a reload or a copied link opens the same comparison.
  React.useEffect(() => { patchHash((h) => applySourceRepo(applyNewPr(h, { source: source ?? undefined, target: target ?? undefined }), headRepo ?? undefined)); }, [source, target, headRepo]);

  const [reload, setReload] = React.useState(0);
  // A fork's branch may share its name with the target (contributor:main into main); the compare then names the fork's owner.
  const headOwner = headRepo?.split("/")[0];
  const pair = source?.trim() && target?.trim() && (headRepo || source !== target) ? { head: source, base: target } : null;
  const cmpLoad = useLoad(pair ? `${repo}|${pair.base}|${headRepo ?? ""}|${pair.head}|${signedIn}` : null, () => (headRepo ? getForkNewPrCompare(repo, pair!.base, headRepo, pair!.head) : getNewPrCompare(repo, pair!.base, pair!.head)), reload);
  const compare = cmpLoad.t === "ready" ? cmpLoad.v : null;
  // The template belongs to the target branch. A failure just means "no template".
  const tplLoad = useLoad(target ? `${repo}|${target}|${signedIn}` : null, () => getPrTemplates(repo, target!).catch(() => []));
  const templates = tplLoad.t === "ready" ? tplLoad.v : null;

  const [title, setTitle] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [tplIdx, setTplIdx] = React.useState(0);
  const touched = React.useRef({ title: false, desc: false });
  const appliedFor = React.useRef("");
  const describe = (c: NewPrCompare, template: string | null) =>
    prefillWorkItems(initialDescription(template, c.commits), newPrWorkItemIds({ branch: source, commits: c.commits }));
  React.useEffect(() => {
    if (!compare || !templates || !pair) return;
    const key = `${pair.head}|${pair.base}`;
    if (appliedFor.current === key) return;
    appliedFor.current = key;
    setTplIdx(0);
    if (!touched.current.title) setTitle(defaultTitle(pair.head, compare.commits));
    if (!touched.current.desc) setDesc(describe(compare, templates[0]?.text ?? null));
  }, [compare, templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const [reviewers, setReviewers] = React.useState<Candidate[]>([]);
  const [labels, setLabels] = React.useState<LabelOption[]>([]);
  const [assignees, setAssignees] = React.useState<Candidate[]>([]);
  const [milestone, setMilestone] = React.useState<MilestoneOption | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; title: string }[]>([]);
  const [adding, setAdding] = React.useState<"" | "reviewers" | "labels" | "workItems" | "assignees" | "milestone" | "projects">("");
  const [viewer, setViewer] = React.useState<string>();
  React.useEffect(() => { if (signedIn) getViewerLogin().then(setViewer, () => {}); }, [signedIn]);
  const [autoOn, setAutoOn] = React.useState(false);
  const [method, setMethod] = React.useState<MergeMethod>("SQUASH");

  const workItemIds = React.useMemo(() => findWorkItemIds(desc), [desc]);
  const wi = useWorkItems(workItemIds);
  const setBody = (v: string) => { touched.current.desc = true; setDesc(v); };

  const forkMissing = headRepo && forksLoad.t === "ready" && !fork ? `You can't see the fork ${headRepo}, so a pull request can't be created from it.` : null;
  const blockers = [...createBlockers({ title, source: source && headOwner ? `${headOwner}:${source}` : source, target, compare }), ...(forkMissing ? [forkMissing] : headRepo && !fork ? [CHECKING_MESSAGE] : [])];
  const [running, setRunning] = React.useState(false);
  const [failed, setFailed] = React.useState<string>();
  const send = async (req: Parameters<typeof mutate>[0]) => {
    try { return { data: await mutate(req) }; } catch (e) { throw new Error(actionErrorText(e)); }
  };
  const create = async (draft: boolean) => {
    if (blockers.length || running || !compare || !pair) return;
    setRunning(true);
    setFailed(undefined);
    try {
      const plan = planCreatePr({
        repositoryId: compare.repoId, baseRefName: pair.base, headRefName: pair.head, title, body: desc, draft, headRepositoryId: fork?.nodeId || undefined,
        reviewerUserIds: reviewers.filter((r) => r.kind === "user").map((r) => r.id),
        reviewerTeamIds: reviewers.filter((r) => r.kind === "team").map((r) => r.id),
        labelIds: labels.map((l) => l.id),
        assigneeIds: assignees.map((a) => a.id),
        milestoneId: milestone?.id ?? null,
        projectIds: projects.map((p) => p.id),
        autoComplete: autoOn ? { mergeMethod: method } : undefined,
        autoMergeAllowed: compare.autoMergeAllowed,
      });
      const out = await executeCreatePlan(plan, send);
      if (!out.created) {
        setFailed(out.message);
        return setRunning(false);
      }
      invalidatePrs();
      // The new page shows the store's notice, so a failed follow-up is not lost with this page.
      if (out.failures.length) actionStore(repo, out.created.number).notice = out.message;
      go({ repo, view: "prs", prTab: "active", pr: out.created.number });
    } catch (e) {
      setFailed(`Could not create the pull request: ${e instanceof Error ? e.message : String(e)}`);
      setRunning(false);
    }
  };

  const swap = () => { setSource(target); setTarget(source); };
  const back = () => go({ repo, view: "prs" });
  const reasons = blockers.join("\n");
  const [tab, setTab] = React.useState<"files" | "commits">("files");
  const notes = blockers.filter((b) => b !== NO_TITLE_MESSAGE && b !== CHECKING_MESSAGE && b !== NO_SOURCE_MESSAGE && b !== NO_TARGET_MESSAGE); // those two are plain: the empty picker says it
  const existing = compare?.existingPr;
  const canAuto = !!compare?.autoMergeAllowed;

  const reviewerRow = (c: Candidate) => (
    <li key={`${c.kind}:${c.id}`} className="gh-pr-row flex-row flex-center">
      <VssPersona imageUrl={c.avatarUrl} displayName={person(c)} size="small" suppressPersonaCard showInitialsOnImageError />
      <span className="gh-pr-grow text-ellipsis">{person(c)}</span>
      {c.kind === "team" && <span className="secondary-text body-s">Team</span>}
      <RemoveButton label={`Remove ${c.kind === "team" ? "team" : "reviewer"} ${person(c)}`} onClick={() => setReviewers((l) => l.filter((x) => x.id !== c.id))} />
    </li>
  );
  const close = () => setAdding("");
  // Reviewers keeps a labelled "Add" as native does; the other panels get a bare "+" with the label as its tooltip.
  const addBtn = (what: typeof adding, text = "Add") => addItem(() => setAdding(what), false, text, what === "reviewers");

  return (
    <>
      <Header
        className="gh-pr-header"
        title="New pull request"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to pull requests", tooltipProps: { text: "Back to pull requests" }, onClick: back }}
      />
      <div className="gh-np-branches flex-row flex-center flex-wrap">
        {(forks.length > 0 || headRepo) && (
          <Dropdown
            className="gh-np-source-repo"
            ariaLabel={`Source repository: ${headRepo ?? repo}`}
            placeholder={headRepo ?? repo}
            items={[{ id: repo, text: repo }, ...forks.map((f) => ({ id: f.fullName, text: f.fullName }))]}
            onSelect={(_e, item) => {
              const next = item.id.toLowerCase() === repo.toLowerCase() ? null : item.id;
              if (next === headRepo) return;
              setHeadRepo(next);
              setSource(next ? forks.find((f) => f.fullName === next)?.defaultBranch ?? null : null); // a branch name means nothing in the other repository
            }}
            renderExpandable={(p) => <DropdownExpandableButton {...p} subtle iconProps={{ iconName: headRepo ? "GitFork" : "Repo" }} />}
          />
        )}
        <BranchBar repo={headRepo ?? repo} current={source ?? ""} defaultBranch={fork?.defaultBranch ?? def.defaultBranch} onPick={setSource} />
        <span className="secondary-text">into</span>
        <BranchBar repo={repo} current={target ?? ""} defaultBranch={def.defaultBranch} onPick={setTarget} />
        <Button subtle iconProps={{ iconName: "Switch" }} ariaLabel="Swap source and target" tooltipProps={{ text: headRepo ? "The source is in a fork, so it can't become the target" : "Swap source and target" }} disabled={(!source && !target) || !!headRepo} onClick={swap} />
      </div>
      <div className="page-content page-content-top gh-np-body">
        {existing && pair && (
          <MessageCard severity={MessageCardSeverity.Info}>
            Pull request #{existing.number} already exists for these branches.{" "}
            <Link href={existingPrHash(repo, existing.number)} onClick={hubClick(() => go({ repo, view: "prs", prTab: "active", pr: existing.number }))}>{VIEW_EXISTING_LABEL}</Link>
          </MessageCard>
        )}
        {notes.filter((n) => !(existing && n.startsWith("Pull request #"))).map((n) => <MessageCard key={n} severity={MessageCardSeverity.Warning}>{n}</MessageCard>)}
        {cmpLoad.t === "loading" && <div className="gh-np-checking flex-row flex-center secondary-text" role="status"><Spinner size={SpinnerSize.small} label="Checking…" /></div>}
        {cmpLoad.t === "error" && <ErrorView err={cmpLoad.err} signIn={signIn} busy={busy} retry={() => { invalidatePrs(); setReload((n) => n + 1); }} subject="compare these branches" permission="Pull requests" />}

        <div className="gh-pr-overview">
          <div className="gh-pr-main gh-np-form">
            <FormItem label="Title" className="gh-np-field">
              <TextField
                ariaLabel="Title"
                value={title}
                maxLength={MAX_TITLE_LENGTH}
                width={TextFieldWidth.auto}
                placeholder="Title"
                onChange={(_e, v) => { touched.current.title = true; setTitle(v); }}
              />
            </FormItem>
            {templates && templates.length > 1 && (
              <FormItem label="Template" className="gh-np-field">
                <Dropdown<number>
                  ariaLabel={`Pull request template: ${baseName(templates[tplIdx]?.path ?? "")}`}
                  placeholder={baseName(templates[tplIdx]?.path ?? "")}
                  items={templates.map((t, i) => ({ id: String(i), text: baseName(t.path) }))}
                  onSelect={(_e, item) => {
                    const i = Number(item.id);
                    setTplIdx(i);
                    touched.current.desc = false;
                    if (compare) setDesc(describe(compare, templates[i].text));
                  }}
                />
              </FormItem>
            )}
            <FormItem label="Description" className="gh-np-field">
              <CommentBox value={desc} set={setBody} label="Description" placeholder="Add a description" submit={() => void create(false)} repo={repo} rows={10} disabled={running} />
            </FormItem>
            {failed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailed(undefined)}>{failed}</MessageCard>}
            <div className="gh-np-actions flex-row flex-center flex-wrap">
              <SplitButton
                primary
                className="gh-split"
                buttonProps={{ text: "Create", onClick: () => void create(false), disabled: !!blockers.length || running, tooltipProps: reasons ? { text: reasons } : undefined }}
                menuButtonProps={{
                  ariaLabel: "More create options",
                  disabled: !!blockers.length || running,
                  contextualMenuProps: { className: "gh-vote-callout", menuProps: { id: "gh-create-menu", items: [{ id: "draft", text: "Create as draft", iconProps: { iconName: "Edit" }, onActivate: () => void create(true) }] } },
                }}
              />
              {running && <Spinner size={SpinnerSize.small} label="Creating…" />}
              {canAuto && (
                <>
                  <Checkbox label="Auto-complete" checked={autoOn} onChange={(_e, v) => setAutoOn(v)} />
                  {autoOn && (
                    <Dropdown<MergeMethod>
                      ariaLabel={`Merge type: ${METHODS.find((m) => m.id === method)!.text}`}
                      placeholder={METHODS.find((m) => m.id === method)!.text}
                      items={METHODS}
                      onSelect={(_e, item) => setMethod(item.id as MergeMethod)}
                      renderExpandable={(p) => <DropdownExpandableButton {...p} />}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="gh-pr-aside">
            <Section title="Reviewers" commandBarItems={addBtn("reviewers")}>
              {adding === "reviewers" && (
                <PeopleAdd repo={repo} kind="reviewers" authorLogin={viewer} current={reviewers.map((r) => ({ kind: r.kind, login: r.login }))} onClose={close} onPick={(c) => (close(), setReviewers((l) => [...l, c]))} />
              )}
              {reviewers.length ? <ul className="gh-pr-list">{reviewers.map(reviewerRow)}</ul> : <Well>No reviewers</Well>}
            </Section>
            <Section title="Work items" commandBarItems={addBtn("workItems")}>
              {adding === "workItems" && <WorkItemsAdd linked={workItemIds} onClose={close} onPick={(w) => (close(), setBody(prefillWorkItems(desc, [w.id])))} />}
              {!workItemIds.length ? <Well>No work items</Well>
                : wi.t === "loading" ? <Spinner size={SpinnerSize.small} ariaLabel="Loading work items" />
                : wi.t === "denied" ? <span className="secondary-text">Work items need the extension's work item permission.</span>
                : wi.t === "error" ? <span className="secondary-text">Work items could not be loaded.</span>
                : <ul className="gh-pr-list">{wi.r.items.map((w) => <WorkItemRow key={w.id} w={w} r={wi.r} remove={{ removable: true, pinned: false, busy: false, onRemove: () => setBody(removeWorkItemFromBody(desc, w.id)) }} />)}</ul>}
            </Section>
            <Section title="Tags" commandBarItems={addBtn("labels")}>
              {adding === "labels" && <LabelsAdd repo={repo} applied={labels.map((l) => l.id)} onClose={close} onPick={(l) => (close(), setLabels((x) => [...x, l]))} />}
              {labels.length ? <div className="flex-row flex-wrap gh-pr-labels">{labels.map((l) => <LabelPill key={l.id} l={l} onRemove={() => setLabels((x) => x.filter((y) => y.id !== l.id))} />)}</div> : <Well>No tags</Well>}
            </Section>
            <Section title="Assignees" commandBarItems={addBtn("assignees")}>
              {adding === "assignees" && <PeopleAdd repo={repo} kind="assignees" current={assignees.map((a) => ({ kind: "user" as const, login: a.login }))} onClose={close} onPick={(c) => (close(), setAssignees((l) => [...l, c]))} />}
              {assignees.length ? (
                <ul className="gh-pr-list">
                  {assignees.map((a) => (
                    <li key={a.id} className="gh-pr-row flex-row flex-center">
                      <VssPersona imageUrl={a.avatarUrl} displayName={person(a)} size="small" suppressPersonaCard showInitialsOnImageError />
                      <span className="gh-pr-grow text-ellipsis">{person(a)}</span>
                      <RemoveButton label={`Remove assignee ${person(a)}`} onClick={() => setAssignees((l) => l.filter((x) => x.id !== a.id))} />
                    </li>
                  ))}
                </ul>
              ) : <Well>No assignees</Well>}
            </Section>
            <Section title="Milestone" commandBarItems={addBtn("milestone", milestone ? "Change" : "Add")}>
              {adding === "milestone" && <MilestoneAdd repo={repo} onClose={close} onPick={(m) => (close(), setMilestone(m))} />}
              {milestone ? (
                <div className="gh-pr-row flex-row flex-center">
                  <Icon iconName="Flag" className="secondary-text" ariaHidden />
                  <span className="gh-pr-grow flex-column"><span className="text-ellipsis">{milestone.title}</span><span className="secondary-text body-s">{dueText(milestone.dueOn)}</span></span>
                  <RemoveButton label={`Clear milestone ${milestone.title}`} onClick={() => setMilestone(null)} />
                </div>
              ) : <Well>No milestone</Well>}
            </Section>
            <Section title="Projects" commandBarItems={addBtn("projects")}>
              {adding === "projects" && <ProjectsAdd repo={repo} attached={projects.map((p) => p.id)} onClose={close} onPick={(p) => (close(), setProjects((l) => [...l, p]))} />}
              {projects.length ? (
                <ul className="gh-pr-list">
                  {projects.map((p) => (
                    <li key={p.id} className="gh-pr-row flex-row flex-center">
                      <Icon iconName="ProjectCollection" className="secondary-text" ariaHidden />
                      <span className="gh-pr-grow text-ellipsis">{p.title}</span>
                      <RemoveButton label={`Remove from project ${p.title}`} onClick={() => setProjects((l) => l.filter((x) => x.id !== p.id))} />
                    </li>
                  ))}
                </ul>
              ) : <Well>No projects</Well>}
            </Section>
          </div>
        </div>

        {compare && pair && compare.ahead > 0 && (
          <div className="gh-np-preview">
            <TabBar ariaLabel="Changes in this pull request" selectedTabId={tab} onSelectedTabChanged={(id) => setTab(id as "files" | "commits")} tabSize={TabSize.Tall} disableSticky>
              <Tab id="files" name="Files" />
              <Tab id="commits" name="Commits" badgeCount={compare.commitCount} />
            </TabBar>
            {tab === "files" ? <FilesPreview repo={repo} base={pair.base} head={headOwner ? `${headOwner}:${pair.head}` : pair.head} headOid={compare.headOid ?? pair.head} signIn={signIn} busy={busy} /> : <CommitsPreview repo={repo} compare={compare} />}
          </div>
        )}
      </div>
    </>
  );
}
