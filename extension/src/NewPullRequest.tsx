// The New pull request page (batch 5), laid out as native's: branches, then Overview / Files / Commits tabs; Overview is one card with
// title, description, reviewers, work items and tags (then GitHub's assignees, milestone and projects), and Create at its foot.
// The logic is in lib/newPr.ts, prTemplates.ts, branchWorkItems.ts, createPrPlan.ts and newPrHash.ts; this file draws it and wires it to the GitHub data layer.
import * as React from "react";
import { PersonHover } from "./HoverCard";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { SplitButton } from "azure-devops-ui/SplitButton";
import { Table, TwoLineTableCell, type ITableColumn } from "azure-devops-ui/Table";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ErrorView, hubClick } from "./Browser";
import { CommentBox } from "./CommentBox";
import { FilesBar } from "./PrFilesBar";
import { FilesView } from "./PrFiles";
import { LabelsField, MilestoneAdd, PeopleField, ProjectsField, RemoveButton, WorkItemsAdd, dueText } from "./PrEdit";
import { TypeIcon, useWorkItems } from "./PrPage";
import { MarkdownPreview } from "./MarkdownPreview";
import { RelDate } from "./RelDate";
import type { WorkItemsResult } from "./workItemsApi";
import type { WorkItemRef } from "./lib/workItems";
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
import { useGh } from "./queryClient";
import "./browser.css";

// ---------- a small loader keyed by what it loads, so a stale answer is never shown for the next pair ----------

type Load<T> = { t: "idle" } | { t: "loading" } | { t: "error"; err: unknown; retry: () => void } | { t: "ready"; v: T };

/** A read through the page's query cache under ["prs", "new", key] (invalidatePrs drops it). Another key starts from loading. */
function useLoad<T>(key: string | null, run: () => Promise<T>): Load<T> {
  const l = useGh<T>(key === null ? null : ["prs", "new", key], run);
  if (key === null) return { t: "idle" };
  return l.t === "ready" ? { t: "ready", v: l.v } : l;
}

const METHODS: { id: MergeMethod; text: string }[] = [{ id: "SQUASH", text: "Squash commit" }, { id: "MERGE", text: "Merge commit" }, { id: "REBASE", text: "Rebase and fast-forward" }];
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// ---------- the preview under the form ----------

export function FilesPreview({ repo, base, head, headOid, signIn, busy }: { repo: string; base: string; head: string; headOid: string; signIn: () => void; busy: boolean }) {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  const [selected, setSelected] = React.useState<string>();
  const [sideBySide, setSideBySide] = React.useState(false);
  const [ws, setWs] = React.useState(false);
  const r = useLoad(`files|${repo}|${base}|${head}`, () => getCompareFiles(repo, base, head)); // the same key as the form's file count, so they share one read
  if (r.t === "loading" || r.t === "idle") return <div className="gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading changed files" /></div>;
  if (r.t === "error") return <ErrorView err={r.err} signIn={signIn} busy={busy} retry={r.retry} subject="compare these branches" permission="Contents" />;
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

/** GitHub refuses a pull request body longer than this. */
const MAX_BODY_LENGTH = 65536;

/** A work item to link, as native's New pull request lists it: type icon, "Type ID: title" linking to the item, "Updated …, ● State", and ×. */
function LinkedWorkItem({ w, r, onRemove }: { w: WorkItemRef; r: WorkItemsResult; onRemove: () => void }) {
  const remove = <RemoveButton label={`Remove work item ${w.id}`} onClick={onRemove} />;
  if (!w.found) return <li className="gh-pr-row flex-row flex-center gh-np-wi"><span className="secondary-text gh-pr-grow">AB#{w.id}: not found or no access</span>{remove}</li>;
  const stateColor = w.type && w.state ? r.types[w.type]?.states?.[w.state] : undefined;
  return (
    <li className="gh-pr-row flex-row flex-center gh-np-wi">
      <div className="flex-column gh-pr-grow gh-np-wi-text">
        <span className="flex-row flex-center gh-np-wi-line1">
          <TypeIcon type={w.type} r={r} />
          <Link className="text-ellipsis" removeUnderline href={r.url(w.id)} target="_blank" rel="noopener noreferrer">{w.type ? `${w.type} ` : ""}{w.id}: {w.title ?? ""}</Link>
        </span>
        <span className="flex-row flex-center secondary-text gh-np-wi-line2">
          {w.changed && <span>Updated <RelDate date={w.changed} />,</span>}
          {w.state && (
            <span className="flex-row flex-center gh-np-wi-state">
              <Icon iconName="CircleFill" className="gh-np-wi-dot" style={stateColor ? { color: `#${stateColor}` } : undefined} ariaHidden />
              {w.state}
            </span>
          )}
        </span>
      </div>
      {remove}
    </li>
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

  // A fork's branch may share its name with the target (contributor:main into main); the compare then names the fork's owner.
  const headOwner = headRepo?.split("/")[0];
  const pair = source?.trim() && target?.trim() && (headRepo || source !== target) ? { head: source, base: target } : null;
  const cmpLoad = useLoad(pair ? `${repo}|${pair.base}|${headRepo ?? ""}|${pair.head}` : null, () => (headRepo ? getForkNewPrCompare(repo, pair!.base, headRepo, pair!.head) : getNewPrCompare(repo, pair!.base, pair!.head)));
  const compare = cmpLoad.t === "ready" ? cmpLoad.v : null;
  // The template belongs to the target branch. A failure just means "no template".
  const tplLoad = useLoad(target ? `templates|${repo}|${target}` : null, () => getPrTemplates(repo, target!).catch(() => []));
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
  const [viewer, setViewer] = React.useState<string>();
  React.useEffect(() => { if (signedIn) getViewerLogin().then(setViewer, () => {}); }, [signedIn]);
  const [autoOn, setAutoOn] = React.useState(false);
  const [method, setMethod] = React.useState<MergeMethod>("SQUASH");

  const workItemIds = React.useMemo(() => findWorkItemIds(desc), [desc]);
  const wi = useWorkItems(workItemIds);
  const setBody = (v: string) => { touched.current.desc = true; setDesc(v); };

  const forkMissing = headRepo && forksLoad.t === "ready" && !fork ? `You can't see the fork ${headRepo}, so a pull request can't be created from it.` : null;
  const tooLong = desc.length > MAX_BODY_LENGTH ? [`The description is longer than GitHub allows (${MAX_BODY_LENGTH} characters).`] : [];
  const blockers = [...tooLong, ...createBlockers({ title, source: source && headOwner ? `${headOwner}:${source}` : source, target, compare }), ...(forkMissing ? [forkMissing] : headRepo && !fork ? [CHECKING_MESSAGE] : [])];
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
  const reasons = blockers.join("\n");
  // Native's tabs: Overview (the form), Files and Commits (what the pull request would bring in).
  const [tab, setTab] = React.useState<"overview" | "files" | "commits">("overview");
  const notes = blockers.filter((b) => b !== NO_TITLE_MESSAGE && b !== CHECKING_MESSAGE && b !== NO_SOURCE_MESSAGE && b !== NO_TARGET_MESSAGE); // those two are plain: the empty picker says it
  const existing = compare?.existingPr;
  const canAuto = !!compare?.autoMergeAllowed;
  const changes = !!(compare && pair && compare.ahead > 0);
  const headRef = pair ? (headOwner ? `${headOwner}:${pair.head}` : pair.head) : "";
  // The Files tab's count, as native shows it before the tab is opened. getCompareFiles is cached, so the tab reuses this answer.
  const filesLoad = useLoad(changes ? `files|${repo}|${pair!.base}|${headRef}` : null, () => getCompareFiles(repo, pair!.base, headRef));
  const fileCount = filesLoad.t === "ready" ? filesLoad.v.files.length : undefined;
  // Native's "Add commit messages": the commits' subjects appended to the description as a list.
  const addCommitMessages = () => {
    if (!compare?.commits.length) return;
    const lines = compare.commits.map((c) => `- ${c.subject}`).join("\n");
    setBody(desc.trim() ? `${desc.replace(/\s+$/, "")}\n\n${lines}` : lines);
  };

  const none = () => undefined; // the inline pickers stay open, so there is nothing to close

  const overview = (
    <Card className="gh-np-card">
      <div className="gh-np-form flex-column flex-grow">
      <FormItem label="Title" className="gh-np-field">
        <TextField ariaLabel="Title" value={title} maxLength={MAX_TITLE_LENGTH} width={TextFieldWidth.auto} placeholder="Title" onChange={(_e, v) => { touched.current.title = true; setTitle(v); }} />
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
      <div className="gh-np-group">
        <Button className="gh-np-group-action" subtle iconProps={{ iconName: "Paste" }} text="Add commit messages" disabled={!compare?.commits.length || running} onClick={addCommitMessages} />
        <FormItem label="Description" className="gh-np-field">
          <CommentBox
            value={desc}
            set={setBody}
            label="Description"
            placeholder="Describe the code that is being reviewed"
            submit={() => void create(false)}
            repo={repo}
            rows={6}
            disabled={running}
            toolbarBelow
            footer={
              <div className="gh-np-desc-foot flex-column">
                <span className={`gh-np-count body-s${desc.length > MAX_BODY_LENGTH ? " gh-np-over" : " secondary-text"}`}>{desc.length}/{MAX_BODY_LENGTH}</span>
                <div className="gh-np-hints flex-row flex-center body-s">
                  <span className="flex-row flex-center"><Icon iconName="Info" className="secondary-text" ariaHidden /><Link removeUnderline href="https://docs.github.com/get-started/writing-on-github" target="_blank" rel="noopener noreferrer">Markdown supported.</Link></span>
                  <span className="flex-row flex-center secondary-text"><Icon iconName="Info" ariaHidden />Type AB# and an ID to link a work item.</span>
                </div>
              </div>
            }
          />
          <MarkdownPreview repo={repo} text={desc} delay={600} live />
        </FormItem>
      </div>
      <FormItem label="Reviewers" className="gh-np-field">
        <PeopleField repo={repo} kind="reviewers" chosen={reviewers} onChange={setReviewers} authorLogin={viewer} placeholder="Search users and teams to add as reviewers" />
      </FormItem>
      <div className="gh-np-group">
        {workItemIds.length > 0 && <Button className="gh-np-group-action" subtle text="Clear all" disabled={running} onClick={() => setBody(workItemIds.reduce((d, id) => removeWorkItemFromBody(d, id), desc))} />}
        <FormItem label={<span className="flex-row flex-center gh-np-label">Work items to link{workItemIds.length > 0 && <Pill containsCount size={PillSize.compact} variant={PillVariant.standard}>{workItemIds.length}</Pill>}</span>} className="gh-np-field">
          <WorkItemsAdd inline linked={workItemIds} placeholder="Search work items by ID or title" onClose={none} onPick={(w) => setBody(prefillWorkItems(desc, [w.id]))} />
          {workItemIds.length > 0 && (
            wi.t === "loading" ? <Spinner size={SpinnerSize.small} ariaLabel="Loading work items" />
              : wi.t === "denied" ? <span className="secondary-text">Work items need the extension's work item permission.</span>
              : wi.t === "error" ? <span className="secondary-text">Work items could not be loaded.</span>
              : <ul className="gh-pr-list gh-np-picked">{wi.r.items.map((w) => <LinkedWorkItem key={w.id} w={w} r={wi.r} onRemove={() => setBody(removeWorkItemFromBody(desc, w.id))} />)}</ul>
          )}
        </FormItem>
      </div>
      <FormItem label="Tags" className="gh-np-field">
        <LabelsField repo={repo} chosen={labels} onChange={setLabels} />
      </FormItem>
      {/* GitHub's own fields, which native ADO has no counterpart for, after native's three. */}
      <FormItem label="Assignees" className="gh-np-field">
        <PeopleField repo={repo} kind="assignees" chosen={assignees} onChange={setAssignees} placeholder="Search users to assign" />
      </FormItem>
      <div className="gh-np-pair">
        <FormItem label="Milestone" className="gh-np-field">
          {milestone ? (
            <div className="gh-pr-row flex-row flex-center gh-np-chosen">
              <Icon iconName="Flag" className="secondary-text" ariaHidden />
              <span className="gh-pr-grow flex-column"><span className="text-ellipsis">{milestone.title}</span><span className="secondary-text body-s">{dueText(milestone.dueOn)}</span></span>
              <RemoveButton label={`Clear milestone ${milestone.title}`} onClick={() => setMilestone(null)} />
            </div>
          ) : <MilestoneAdd inline repo={repo} onClose={none} onPick={setMilestone} />}
        </FormItem>
        <FormItem label="Projects" className="gh-np-field">
          <ProjectsField repo={repo} chosen={projects} onChange={setProjects} />
        </FormItem>
      </div>
      {failed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailed(undefined)}>{failed}</MessageCard>}
      <div className="gh-np-actions flex-row flex-center flex-wrap">
        {running && <Spinner size={SpinnerSize.small} label="Creating…" />}
        {canAuto && (
          <>
            <Checkbox label="Set auto-complete" checked={autoOn} onChange={(_e, v) => setAutoOn(v)} />
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
      </div>
      </div>
    </Card>
  );

  const nothingYet = <ZeroData iconProps={{ iconName: "BranchCompare" }} imageAltText="" primaryText="No changes to show" secondaryText="Choose a source branch with commits the target doesn't have." />;

  return (
    <>
      <Header className="gh-pr-header" title="New pull request" titleSize={TitleSize.Large} titleAriaLevel={1} />
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
      <TabBar ariaLabel="New pull request" selectedTabId={tab} onSelectedTabChanged={(id) => setTab(id as typeof tab)} tabSize={TabSize.Tall} disableSticky>
        <Tab id="overview" name="Overview" />
        <Tab id="files" name="Files" badgeCount={changes ? fileCount : undefined} />
        <Tab id="commits" name="Commits" badgeCount={changes ? compare!.commitCount : undefined} />
      </TabBar>
      <div className="page-content page-content-top gh-np-body">
        {existing && pair && (
          <MessageCard severity={MessageCardSeverity.Info}>
            Pull request #{existing.number} already exists for these branches.{" "}
            <Link href={existingPrHash(repo, existing.number)} onClick={hubClick(() => go({ repo, view: "prs", prTab: "active", pr: existing.number }))}>{VIEW_EXISTING_LABEL}</Link>
          </MessageCard>
        )}
        {notes.filter((n) => !(existing && n.startsWith("Pull request #"))).map((n) => <MessageCard key={n} severity={MessageCardSeverity.Warning}>{n}</MessageCard>)}
        {cmpLoad.t === "loading" && <div className="gh-np-checking flex-row flex-center secondary-text" role="status"><Spinner size={SpinnerSize.small} label="Checking…" /></div>}
        {cmpLoad.t === "error" && <ErrorView err={cmpLoad.err} signIn={signIn} busy={busy} retry={() => { invalidatePrs(); cmpLoad.retry(); }} subject="compare these branches" permission="Pull requests" />}
        {tab === "overview" ? overview
          : !changes ? nothingYet
          : tab === "files" ? <FilesPreview repo={repo} base={pair!.base} head={headRef} headOid={compare!.headOid ?? pair!.head} signIn={signIn} busy={busy} />
          : <CommitsPreview repo={repo} compare={compare!} />}
      </div>
    </>
  );
}
