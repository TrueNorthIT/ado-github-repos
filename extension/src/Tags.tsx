// The "Tags" hub (T-1, T-2): tags in folders, newest first; create (lightweight or annotated) and delete.
import * as React from "react";
import { RelDate } from "./RelDate";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MoreButton } from "azure-devops-ui/Menu";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { buildRefTree, type RefLeaf } from "./lib/branches";
import { branchFromTagMutation, type TagRow } from "./lib/tags";
import { ErrorView } from "./Browser";
import { HubProps, Loading, PersonLine, RepoHubPage, titleSwitcher } from "./RepoHub";
import { ConfirmDeleteDialog, NewBranchDialog, NewTagDialog } from "./RefDialogs";
import { RefColumn, RefTree } from "./RefTree";
import { createTag, deleteRef, mutate, findCommit, invalidateRefs, listAllBranches, listAllTags, type BranchesData, type TagsData } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import { RefWriteError, useRefWrites } from "./refWrites";
import "./browser.css";

const NO_BRANCHES: string[] = [];

function TagList({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const href = useHubHref();
  const writes = useRefWrites();
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: TagsData }>({ t: "loading" });
  const [branches, setBranches] = React.useState<BranchesData | undefined>();
  const [reload, setReload] = React.useState(0);
  const [query, setQuery] = React.useState(state.q ?? "");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = React.useState<{ kind: "new" } | { kind: "delete"; tag: TagRow } | { kind: "branch"; tag: TagRow } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    listAllTags(repo).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    listAllBranches(repo).then((v) => !dead && setBranches(v), () => {}); // only the New tag dialog needs these
    return () => { dead = true; };
  }, [repo, signedIn, reload]);

  React.useEffect(() => {
    const t = setTimeout(() => { if ((state.q ?? "") !== query.trim()) go({ ...state, q: query.trim() || undefined }, true); }, 300);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = data.t === "ready" ? data.v : undefined;
  const nodes = React.useMemo(() => buildRefTree(v?.tags ?? [], { query: state.q }), [v, state.q]);
  const refresh = () => setReload((n) => n + 1);
  const toggleFolder = React.useCallback((p: string) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; }), []);
  const branchNames = branches?.branches.map((b) => b.name) ?? NO_BRANCHES;
  const defaultBranch = branches?.defaultBranch ?? branchNames[0] ?? "";

  const columns = React.useMemo<RefColumn<TagRow>[]>(() => [
    {
      id: "commit", name: "Commit", width: 110,
      render: ({ item: t }) => <Link className="gh-sha-link monospaced-xs" href={href("commits", { repo, commit: t.sha })} onClick={openInHub("commits", { repo, commit: t.sha })} ariaLabel={`Commit ${t.shortSha}`}>{t.shortSha}</Link>,
    },
    { id: "author", name: "Tagger / Author", width: 170, render: ({ item: t }) => <PersonLine person={t.author} /> },
    { id: "date", name: "Date", width: 120, render: ({ item: t }) => <RelDate date={t.date} /> },
    { id: "message", name: "Message", width: -60, render: ({ item: t }) => <span className="text-ellipsis secondary-text" title={t.message}>{t.message?.split("\n")[0] ?? ""}</span> },
    {
      id: "more", name: "", width: 40,
      render: ({ item: t }) => (
        <MoreButton
          ariaLabel={`Actions for ${t.name}`}
          contextualMenuProps={{
            menuProps: {
              id: `gh-tag-menu-${t.name}`,
              items: [
                { id: "delete", text: "Delete tag", iconProps: { iconName: "Delete" }, disabled: writes.busy, onActivate: () => setDialog({ kind: "delete", tag: t }) },
                { id: "branch", text: "New branch from tag", iconProps: { iconName: "BranchFork2" }, disabled: writes.busy || !t.sha, onActivate: () => setDialog({ kind: "branch", tag: t }) },
                { id: "browse", text: "Browse files", iconProps: { iconName: "OpenSource" }, href: href("files", { repo, ref: t.name }), onActivate: openInHub("files", { repo, ref: t.name }) as any },
                { id: "history", text: "View history", iconProps: { iconName: "History" }, href: href("commits", { repo, ref: `refs/tags/${t.name}` }), onActivate: openInHub("commits", { repo, ref: `refs/tags/${t.name}` }) as any },
                { id: "copy", text: "Copy tag name", iconProps: { iconName: "Copy" }, onActivate: () => { void navigator.clipboard?.writeText(t.name); } },
              ],
            },
          }}
        />
      ),
    },
  ], [href, repo, writes.busy]);

  const nameCell = React.useCallback((leaf: RefLeaf<TagRow>) => (
    <>
      <span className="gh-entry-icon"><Icon iconName="Tag" size={IconSize.small} /></span>
      <Link className="bolt-table-link text-ellipsis" subtle removeUnderline href={href("files", { repo, ref: leaf.item.name })} onClick={openInHub("files", { repo, ref: leaf.item.name })}>{leaf.name}</Link>
      {leaf.item.annotated && <span className="gh-tag-kind secondary-text body-s">annotated</span>}
    </>
  ), [href, repo]);

  const create = (p: { name: string; base: string; sha: string; message: string }) => {
    if (!v) return;
    void writes.run(async () => {
      let oid = branches?.branches.find((b) => b.name === p.base)?.sha;
      if (p.sha) {
        const c = await findCommit(repo, p.sha);
        if (!c) throw new RefWriteError(`No commit starts with ${p.sha}.`);
        oid = c.sha;
      }
      if (!oid) throw new RefWriteError("No commit to tag.");
      await createTag(repo, v.repoId, { name: p.name, oid, message: p.message });
    }, () => { setDialog(null); refresh(); });
  };
  const createBranchFrom = (tag: TagRow, name: string) => {
    if (!v) return;
    void writes.run(() => mutate(branchFromTagMutation(v.repoId, tag, name)), () => { setDialog(null); setNotice(`Created branch ${name} from tag ${tag.name}.`); });
  };
  const doDelete = (t: TagRow) => void writes.run(() => deleteRef(t.id), () => { setDialog(null); setNotice(`Deleted tag ${t.name}.`); refresh(); });
  const closeDialog = () => { if (!writes.busy) { setDialog(null); writes.clearError(); } };

  const error = data.t === "error" ? data.err : null;
  const none = !!v && !v.tags.length;
  return (
    <>
      <Header
        className="gh-hub-header"
        title="Tags"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "new", text: "New tag", isPrimary: true, important: true, disabled: !v || writes.busy, onActivate: () => setDialog({ kind: "new" }) },
          {
            id: "search", text: "Search tag name", important: true,
            renderButton: () => <TextField key="search" className="gh-ref-search" value={query} onChange={(_e, t) => setQuery(t)} placeholder="Search tag name" ariaLabel="Search tag name" prefixIconProps={{ iconName: "Filter" }} />,
          },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
        {writes.error && !dialog && <MessageCard severity={MessageCardSeverity.Error} onDismiss={writes.clearError}>{writes.error}</MessageCard>}
        {error ? (
          <ErrorView err={error} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); refresh(); }} subject="see this repository's tags" permission="Contents" />
        ) : data.t === "loading" ? (
          <Loading label="Loading tags" />
        ) : none ? (
          <Card className="gh-pr-card gh-refs-card gh-tags-empty" contentProps={{ contentPadding: false }}>
            <ZeroData iconProps={{ iconName: "Tag" }} imageAltText="" primaryText="This repository has no tags" secondaryText="Use tags to mark a point in history that is relevant to the repository." />
          </Card>
        ) : !nodes.length ? (
          <ZeroData iconProps={{ iconName: "Tag" }} imageAltText="" primaryText="No tags match" />
        ) : (
          <Card className="gh-pr-card gh-refs-card bolt-table-card" contentProps={{ contentPadding: false }}>
            <RefTree<TagRow> nodes={nodes} columns={columns} name="Tag" nameCell={nameCell} collapsed={collapsed} toggleFolder={toggleFolder} label="Tags" onOpen={() => {}} />
          </Card>
        )}
      </div>
      {dialog?.kind === "new" && v && (
        <NewTagDialog branches={branchNames} existing={v.tags.map((t) => t.name)} defaultBase={defaultBranch} busy={writes.busy} error={writes.error} clearError={writes.clearError} create={create} close={closeDialog} />
      )}
      {dialog?.kind === "branch" && v && (
        <NewBranchDialog branches={branchNames} existing={branchNames} defaultBase="" fixedBase={`Tag ${dialog.tag.name} (${dialog.tag.shortSha})`} busy={writes.busy} error={writes.error} clearError={writes.clearError} create={(name) => createBranchFrom(dialog.tag, name)} close={closeDialog} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog what="tag" name={dialog.tag.name} busy={writes.busy} error={writes.error} clearError={writes.clearError} confirm={() => doDelete(dialog.tag)} close={closeDialog} />
      )}
    </>
  );
}

export function TagsHub(props: HubProps) {
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => <TagList repo={repo} props={props} />}
    </RepoHubPage>
  );
}
