// Commit detail (C-3): header, the Files tab (tree plus per-file diffs, side-by-side or inline) and the Details tab.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { ClipboardButton } from "azure-devops-ui/Components/ClipboardButton/ClipboardButton";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { IconSize } from "azure-devops-ui/Icon";
import { Pill, PillSize } from "azure-devops-ui/Pill";
import type { CommitDetail } from "./lib/commitDetail";
import { defaultParentOption, parentOptions } from "./lib/commitDetail";
import type { PrFile } from "./lib/prFiles";
import { githubUrl } from "./lib/githubUrl";
import { commitUrl } from "./lib/commits";
import { shortDate } from "./lib/dateText";
import { ErrorView, hubClick } from "./Browser";
import { FilesView } from "./PrFiles";
import { RepoIcon } from "./fileIcons";
import { CheckStatusCell, HubProps, Loading, PersonLine, useDefaultBranch } from "./RepoHub";
import { getCommitDetail, getCommitFiles, invalidateRefs } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import { usePrefs } from "./prefs";
import { watchTheme } from "./theme";
import { MoreButton } from "azure-devops-ui/Menu";
import "./browser.css";

type Load<T> = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };

function useLoad<T>(make: () => Promise<T>, deps: unknown[]): [Load<T>, () => void] {
  const [load, setLoad] = React.useState<Load<T>>({ t: "loading" });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    make().then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [load, () => { invalidateRefs(); setN((x) => x + 1); }];
}

// ---------- the header's second line ----------

function Meta({ d, repo, branch, branchHref, openBranch }: { d: CommitDetail; repo: string; branch?: string; branchHref: string; openBranch: (e?: React.MouseEvent | React.KeyboardEvent) => void }) {
  return (
    <div className="gh-pr-meta flex-row flex-center">
      <span className="gh-pr-meta-text">
        <span className="monospaced-xs secondary-text gh-commit-sha">{d.shortSha}</span>
        <ClipboardButton className="gh-pr-copy" getContent={() => d.sha} ariaLabel={`Copy commit SHA ${d.sha}`} showCopiedTooltip subtle />
        <PersonLine person={d.author} size="extra-extra-small" className="font-weight-semibold" />
        <span className="secondary-text">committed {shortDate(d.committedDate)}</span>
        {branch && <Link className="gh-pr-branch-link" href={branchHref} onClick={openBranch}>{branch}</Link>}
        <CheckStatusCell status={d.status} />
      </span>
    </div>
  );
}

// ---------- Details tab ----------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gh-detail-row flex-row">
      <div className="gh-detail-label secondary-text body-s font-weight-semibold">{label}</div>
      <div className="gh-detail-value body-m">{children}</div>
    </div>
  );
}

function Details({ d, repo, parentHref, openParent }: { d: CommitDetail; repo: string; parentHref: (sha: string) => string; openParent: (sha: string) => void }) {
  return (
    <div className="page-content page-content-top flex-column">
      <Card className="gh-pr-card" contentProps={{ contentPadding: true }}>
        <div className="gh-detail flex-column">
          <Row label="Message"><pre className="gh-detail-message">{d.message}</pre></Row>
          <Row label="Author"><PersonLine person={d.author} /> <span className="secondary-text">on {d.authoredDate.toLocaleString()}</span></Row>
          <Row label="Committer"><PersonLine person={d.committer} /> <span className="secondary-text">on {d.committedDate.toLocaleString()}</span></Row>
          <Row label={d.parents.length === 1 ? "Parent" : "Parents"}>
            {d.parents.length ? (
              d.parents.map((p) => (
                <div key={p}>
                  <Link className="monospaced-xs" href={parentHref(p)} onClick={hubClick(() => openParent(p))}>{p}</Link>
                </div>
              ))
            ) : (
              <span className="secondary-text">None (initial commit)</span>
            )}
          </Row>
          <Row label="SHA"><span className="monospaced-xs">{d.sha}</span> <ClipboardButton className="gh-pr-copy" getContent={() => d.sha} ariaLabel="Copy the full commit SHA" showCopiedTooltip subtle /></Row>
          {d.treeSha && <Row label="Tree"><span className="monospaced-xs">{d.treeSha}</span></Row>}
          {d.signature && (
            <Row label="Signature">
              <Pill size={PillSize.regular}>{d.signature.valid ? "Verified" : "Unverified"}</Pill> <span className="secondary-text">{d.signature.state.toLowerCase().replace(/_/g, " ")}</span>
            </Row>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------- Files tab ----------

function FilesTab({ d, repo, parent, setParent, dark, props }: { d: CommitDetail; repo: string; parent: number; setParent: (n: number) => void; dark: boolean; props: HubProps }) {
  const options = React.useMemo(() => parentOptions(d.parents), [d.parents]);
  const option = options[Math.min(Math.max(parent, 1), options.length) - 1] ?? defaultParentOption(d.parents);
  const [prefs, setPrefs] = usePrefs();
  const [load, retry] = useLoad<PrFile[]>(() => getCommitFiles(repo, d.sha, option), [repo, d.sha, option.baseSha, props.signedIn]);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [selected, setSelected] = React.useState<string | undefined>();
  if (load.t === "loading") return <Loading label="Loading changed files" />;
  if (load.t === "error")
    return <div className="page-content page-content-top"><ErrorView err={load.err} signIn={() => void props.signIn()} busy={props.busy} retry={retry} subject="see this commit's files" permission="Contents" /></div>;

  const q = text.trim().toLowerCase();
  const files = q ? load.v.filter((f) => f.path.toLowerCase().includes(q)) : load.v;
  const sideBySide = prefs.sideBySide;
  const bar = (
    <div className="gh-commit-files-bar flex-row flex-center body-m">
      <Dropdown
        ariaLabel={`Compare against: ${option.label}`}
        className="gh-parent-picker"
        placeholder={`${option.label} → This commit`}
        items={options.map((o, i) => ({ id: String(i + 1), text: `${o.label} → This commit` }))}
        onSelect={(_e, item) => setParent(Number(item.id))}
        renderExpandable={(p) => <DropdownExpandableButton {...p} />}
      />
      {filterOpen ? (
        <TextField className="gh-file-filter" value={text} onChange={(_e, v) => setText(v)} placeholder="Filter by file name" ariaLabel="Filter changed files by name" prefixIconProps={{ iconName: "Filter" }} autoFocus onKeyDown={(e) => { if (e.key === "Escape") { setText(""); setFilterOpen(false); } }} />
      ) : (
        <Button text="Filter" iconProps={{ iconName: "Filter" }} onClick={() => setFilterOpen(true)} />
      )}
      <span className="gh-changed-count" role="status">{files.length === load.v.length ? `${files.length} changed ${files.length === 1 ? "file" : "files"}` : `${files.length} of ${load.v.length} changed files`}</span>
      <span className="flex-grow" />
      <Dropdown
        ariaLabel={`Diff layout: ${sideBySide ? "Side-by-side" : "Inline"}`}
        className="gh-layout-picker"
        placeholder={sideBySide ? "Side-by-side" : "Inline"}
        items={[{ id: "side", text: "Side-by-side", iconProps: { iconName: "DiffSideBySide" } }, { id: "inline", text: "Inline", iconProps: { iconName: "DiffInline" } }]}
        onSelect={(_e, item) => setPrefs((p) => ({ ...p, sideBySide: item.id === "side" }))}
        renderExpandable={(p) => <DropdownExpandableButton {...p} iconProps={{ iconName: sideBySide ? "DiffSideBySide" : "DiffInline", size: IconSize.medium }} />}
      />
    </div>
  );
  if (!load.v.length)
    return <div className="gh-pr-files flex-column">{bar}<ZeroData iconProps={{ iconName: "Page" }} imageAltText="" primaryText="No files changed" secondaryText="This commit does not change any files." /></div>;
  return (
    <FilesView
      key={option.baseSha ?? "root"}
      files={files}
      repo={repo}
      ctx={{ baseSha: option.baseSha, headSha: d.sha }}
      selected={selected}
      select={setSelected}
      dark={dark}
      sideBySide={sideBySide}
      bar={bar}
      treeHeader={<div className="repos-file-explorer-header flex-row flex-center body-xl"><RepoIcon /><span className="text-ellipsis">{repo}</span></div>}
    />
  );
}

// ---------- the page ----------

export function CommitDetailPage({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go } = props;
  const sha = state.commit!;
  const href = useHubHref();
  const { defaultBranch } = useDefaultBranch(repo);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  const [load, retry] = useLoad(() => getCommitDetail(repo, sha), [repo, sha, props.signedIn]);
  const tab = state.commitTab ?? "files";
  const back = () => go({ repo, ref: state.ref });
  const set = (s: Partial<typeof state>) => go({ ...state, ...s });

  if (load.t === "error")
    return (
      <>
        <Header className="gh-pr-header" title="Commit" titleSize={TitleSize.Large} titleAriaLevel={1} backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to commits", onClick: back }} />
        <div className="page-content page-content-top"><ErrorView err={load.err} signIn={() => void props.signIn()} busy={props.busy} retry={retry} back={back} subject="see this commit" permission="Contents" /></div>
      </>
    );
  const d = load.t === "ready" ? load.v : undefined;
  const branch = state.ref ?? defaultBranch;
  const ghUrl = commitUrl(repo, d?.sha ?? sha);
  return (
    <>
      <Header
        className="gh-pr-header"
        title={d?.title ?? "Commit"}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to commits", tooltipProps: { text: "Back to commits" }, onClick: back }}
        commandBarItems={[
          { id: "browse", text: "Browse Files", important: true, href: href("files", { repo, ref: d?.sha ?? sha }), onActivate: () => void openInHub("files", { repo, ref: d?.sha ?? sha })() },
          {
            id: "more", important: true,
            renderButton: () => (
              <MoreButton
                key="more"
                ariaLabel="More actions"
                contextualMenuProps={{
                  menuProps: {
                    id: "gh-commit-menu",
                    items: [
                      { id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, onActivate: () => { window.open(ghUrl, "_blank", "noopener"); } },
                      { id: "copy", text: "Copy SHA", iconProps: { iconName: "Copy" }, onActivate: () => { void navigator.clipboard?.writeText(d?.sha ?? sha); } },
                    ],
                  },
                }}
              />
            ),
          },
        ]}
      />
      <div className="gh-pr-sub">
        {d ? <Meta d={d} repo={repo} branch={branch} branchHref={href("files", { repo, ref: branch })} openBranch={openInHub("files", { repo, ref: branch })} /> : <div className="gh-pr-meta" />}
      </div>
      <TabBar ariaLabel="Commit" selectedTabId={tab} onSelectedTabChanged={(id) => set({ commitTab: id as "files" | "details" })} tabSize={TabSize.Tall} disableSticky>
        <Tab id="files" name="Files" />
        <Tab id="details" name="Details" />
      </TabBar>
      {!d ? <Loading label="Loading commit" /> : tab === "details" ? (
        <Details d={d} repo={repo} parentHref={(p) => href("commits", { repo, ref: state.ref, commit: p })} openParent={(p) => go({ repo, ref: state.ref, commit: p })} />
      ) : (
        <FilesTab d={d} repo={repo} parent={state.parent ?? 1} setParent={(n) => set({ parent: n === 1 ? undefined : n })} dark={dark} props={props} />
      )}
    </>
  );
}
