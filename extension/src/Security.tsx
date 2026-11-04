// The "Advanced Security" hub (R2): GitHub's Dependabot, code scanning and secret scanning alerts in the shape of Azure DevOps' Advanced Security pages.
// The pure parts are in lib/security*.ts; the calls are in securityData.ts. The hash (view=security, secTab, alert, secState...) is routed from useHashExtras().security.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown, DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Tab, TabBadge, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { ITableColumn, SimpleTableCell, Table, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { KeywordFilterBarItem, TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData, ZeroDataActionType } from "azure-devops-ui/ZeroData";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { parseColor } from "azure-devops-ui/Utilities/Color";
import { ErrorView, Markdown, BranchPicker } from "./Browser";
import { HubProps, Loading, RepoHubPage, skeletonRows, titleSwitcher } from "./RepoHub";
import { RelDate } from "./RelDate";
import { GhError, listBranches, renderMarkdown } from "./githubBrowse";
import { gotoHash, patchHash, useHashExtras } from "./hostNav";
import { filterBranches } from "./lib/branchSwitch";
import { prepareMarkdownHtml, type PreparedMarkdown } from "./lib/markdown";
import { availability } from "./lib/securityAvailability";
import { alertDetailHash, applySecurity, kindForTab, serializeSecurity, tabForKind, type SecretValidity, type SecTab, type SecurityHashState } from "./lib/securityHash";
import { filterRows, severityPill, type AlertInstance, type AlertRow, type SecretLocation, type AlertState, type Severity } from "./lib/securityModel";
import { dismissReasons, MAX_DISMISS_COMMENT } from "./lib/securityRequests";
import type { AlertCount } from "./lib/securityCounts";
import type { AlertKind, RatedSeverity, SecurityFilters, StateFilter } from "./lib/securityTypes";
import type { SnippetLine } from "./lib/codeSnippet";
import { dismissAlert, listAlerts, loadDetail, loadSnippet, openCount, reopenAlert, toApiError, writeErrorText, type AlertPage, type DetailData } from "./securityData";
import "./browser.css";

const TABS: { id: SecTab; name: string }[] = [
  { id: "dependencies", name: "Dependencies" },
  { id: "code", name: "Code scanning" },
  { id: "secrets", name: "Secrets" },
];
const STATES: { id: StateFilter; text: string }[] = [{ id: "open", text: "Open" }, { id: "closed", text: "Closed" }, { id: "dismissed", text: "Dismissed" }, { id: "fixed", text: "Fixed" }];
const SEVERITIES: RatedSeverity[] = ["Critical", "High", "Medium", "Low", "Note"];
/** The ecosystems the Dependabot alerts list filters on (REST `ecosystem`). */
const ECOSYSTEMS: { id: string; text: string }[] = [
  { id: "composer", text: "Composer" }, { id: "go", text: "Go" }, { id: "maven", text: "Maven" }, { id: "npm", text: "npm" }, { id: "nuget", text: "NuGet" },
  { id: "pip", text: "pip" }, { id: "pub", text: "Pub" }, { id: "rubygems", text: "RubyGems" }, { id: "rust", text: "Rust" },
];
const VALIDITIES: { id: SecretValidity; text: string }[] = [{ id: "active", text: "Active" }, { id: "inactive", text: "Inactive" }, { id: "unknown", text: "Unknown" }];
const DEBOUNCE_MS = 300;
const STATE_TEXT: Record<AlertState, string> = { Open: "Open", Dismissed: "Dismissed", Fixed: "Fixed", Resolved: "Resolved", AutoDismissed: "Auto-dismissed" };

// ---------- small parts ----------

export const SeverityPill = ({ severity }: { severity: Severity }) => {
  const p = severityPill(severity);
  const color = parseColor(p.background);
  return <Pill className="gh-sec-pill" size={PillSize.compact} variant={color ? PillVariant.colored : PillVariant.standard} color={color}>{p.label}</Pill>;
};

/** Why a tab has no alerts to show, from availability(): the enable prompt, the missing permission, not found, or a failure. */
function Unavailable({ kind, repo, err, retry, signIn, busy }: { kind: AlertKind; repo: string; err: unknown; retry: () => void; signIn: () => void; busy: boolean }) {
  if (err instanceof GhError && err.kind === "auth") return <ErrorView err={err} signIn={signIn} busy={busy} retry={retry} subject="see this repository's security alerts" />;
  const a = availability(kind, toApiError(err), repo);
  if (a.state === "disabled")
    return (
      <ZeroData
        iconProps={{ iconName: "Shield" }}
        imageAltText=""
        primaryText={a.message}
        secondaryText="Turn it on in the repository's security settings on GitHub."
        actionText={a.actionLabel}
        actionType={ZeroDataActionType.ctaButton}
        onActionClick={() => window.open(a.actionUrl, "_blank", "noopener")}
      />
    );
  if (a.state === "noPermission") return <MessageCard severity={MessageCardSeverity.Warning}>{a.message}</MessageCard>;
  if (a.state === "notFound") return <MessageCard severity={MessageCardSeverity.Info}>{a.message}</MessageCard>;
  return (
    <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: retry }]}>
      {a.message}{a.resetAt ? ` It resets at ${a.resetAt.toLocaleTimeString()}.` : ""}
    </MessageCard>
  );
}

/** GitHub-rendered markdown, sanitised by prepareMarkdownHtml; plain text if the render fails. */
function MarkdownText({ repo, text, go }: { repo: string; text: string; go: HubProps["go"] }) {
  const [prepared, setPrepared] = React.useState<PreparedMarkdown | "failed" | undefined>();
  React.useEffect(() => {
    setPrepared(undefined);
    if (!text.trim()) return;
    let dead = false;
    renderMarkdown(repo, text).then(
      (html) => !dead && setPrepared(prepareMarkdownHtml(html, { owner: repo.split("/")[0], name: repo.split("/")[1], ref: "HEAD", dir: "" })),
      () => !dead && setPrepared("failed")
    );
    return () => { dead = true; };
  }, [repo, text]);
  if (!text.trim()) return null;
  if (prepared === "failed") return <div className="gh-sec-plain">{text}</div>;
  if (!prepared) return <div className="gh-sec-plain secondary-text">Loading</div>;
  return <Markdown prepared={prepared} repo={repo} refName="HEAD" go={go} />;
}

// ---------- the list ----------

const NO_BRANCHES: string[] = [];

/** The branch picker as a filter bar item (a class: FilterBar clones its children with a ref). */
class BranchItem extends React.Component<{ filterItemKey: string; repo: string; branch: string; onPick: (b: string) => void }, { branches?: string[]; query: string }> {
  state: { branches?: string[]; query: string } = { query: "" };
  focus() {}
  render() {
    const { branch, repo, onPick } = this.props;
    const items = [{ id: "", text: "All branches" }, ...filterBranches(this.state.branches ?? NO_BRANCHES, this.state.query).map((b) => ({ id: b, text: b }))];
    return (
      <BranchPicker
        refName={branch || "All branches"}
        items={items}
        loading={!this.state.branches}
        onOpen={() => { if (!this.state.branches) listBranches(repo).then((b) => this.setState({ branches: b }), () => this.setState({ branches: [] })); }}
        setQuery={(q) => this.setState({ query: q })}
        onSelect={onPick}
      />
    );
  }
}

const sevSelection = (s?: string) => { const d = new DropdownSelection(); if (s) d.select(SEVERITIES.indexOf(s as RatedSeverity)); return d; };
const pickSelection = (items: { id: string }[], v?: string) => { const d = new DropdownSelection(); const i = items.findIndex((x) => x.id === v); if (i >= 0) d.select(i); return d; };
const stateSelection = (s: StateFilter) => { const d = new DropdownSelection(); d.select(STATES.findIndex((x) => x.id === s)); return d; };

function columns(kind: AlertKind, repo: string, open: (n: number) => void): ITableColumn<AlertRow>[] {
  const locName = kind === "dependabot" ? "Package" : kind === "code" ? "Location" : "Found in";
  return [
    ...(kind === "secret" ? [] : [{
      id: "severity", name: "Severity", width: 96,
      renderCell: (_r: number, c: number, col: ITableColumn<AlertRow>, row: AlertRow) => <SimpleTableCell key="sev" columnIndex={c} tableColumn={col}><SeverityPill severity={row.severity} /></SimpleTableCell>,
    }]),
    {
      id: "title", name: kind === "secret" ? "Secret" : "Alert", width: -50, columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, c, col, row) => (
        <TwoLineTableCell
          key="title" columnIndex={c} tableColumn={col}
          line1={<Link className="gh-pr-title body-m" subtle removeUnderline href={alertDetailHash(repo, kind, row.number)} onClick={(e) => { e.preventDefault(); open(row.number); }}>{row.title}</Link>}
          line2={<span className="secondary-text body-s">#{row.number}{row.ruleId && kind !== "secret" ? ` · ${row.ruleId}` : ""}{row.tool ? ` · ${row.tool}` : ""}</span>}
        />
      ),
    },
    { id: "location", name: locName, width: -30, columnLayout: kind === "dependabot" ? TableColumnLayout.twoLine : TableColumnLayout.singleLine, renderCell: (_r, c, col, row) => row.manifestPath ? (
      <TwoLineTableCell key="loc" columnIndex={c} tableColumn={col}
        line1={<span className="text-ellipsis monospaced-xs" title={row.location}>{row.location}</span>}
        line2={<span className="text-ellipsis secondary-text body-s monospaced-xs" title={row.manifestPath}>{row.manifestPath}</span>} />
    ) : <SimpleTableCell key="loc" columnIndex={c} tableColumn={col}><span className="text-ellipsis monospaced-xs" title={row.location}>{row.location}</span></SimpleTableCell> },
    { id: "detected", name: "First detected", width: 130, renderCell: (_r, c, col, row) => <SimpleTableCell key="det" columnIndex={c} tableColumn={col}><RelDate date={row.firstDetected} /></SimpleTableCell> },
    { id: "state", name: "State", width: 110, renderCell: (_r, c, col, row) => <SimpleTableCell key="st" columnIndex={c} tableColumn={col}>{STATE_TEXT[row.state]}</SimpleTableCell> },
  ];
}

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; page: AlertPage };

function AlertList({ repo, kind, seed, props }: { repo: string; kind: AlertKind; seed: SecurityHashState | null; props: HubProps }) {
  const tab = tabForKind(kind);
  const filter = React.useMemo(() => {
    const f = new Filter();
    f.setState({ text: { value: seed?.text ?? "" }, state: { value: [seed?.state ?? "open"] }, severity: { value: seed?.severity ? [seed.severity] : [] }, tool: { value: seed?.tool ?? "" }, rule: { value: seed?.rule ?? "" }, ecosystem: { value: seed?.ecosystem ? [seed.ecosystem] : [] }, package: { value: seed?.package ?? "" }, validity: { value: seed?.validity ? [seed.validity] : [] } }, true);
    return f;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the hash only seeds it
  const stateSel = React.useMemo(() => stateSelection(seed?.state ?? "open"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sevSel = React.useMemo(() => sevSelection(seed?.severity), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ecoSel = React.useMemo(() => pickSelection(ECOSYSTEMS, seed?.ecosystem), []); // eslint-disable-line react-hooks/exhaustive-deps
  const valSel = React.useMemo(() => pickSelection(VALIDITIES, seed?.validity), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [applied, setApplied] = React.useState({ state: (seed?.state ?? "open") as StateFilter, severity: seed?.severity, branch: seed?.branch ?? "", tool: seed?.tool ?? "", rule: seed?.rule ?? "", text: seed?.text ?? "", ecosystem: seed?.ecosystem ?? "", package: seed?.package ?? "", validity: seed?.validity as SecretValidity | undefined });
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [more, setMore] = React.useState<{ busy: boolean; err: boolean }>({ busy: false, err: false });
  const [reload, setReload] = React.useState(0);

  // Typing is debounced; every change is kept in the hash so a reload or a link keeps it.
  const commit = React.useCallback((next: typeof applied) => {
    setApplied(next);
    patchHash((h) => applySecurity(h, { tab, state: next.state === "open" ? undefined : next.state, severity: next.severity, branch: next.branch, tool: next.tool, rule: next.rule, text: next.text, ecosystem: next.ecosystem, package: next.package, validity: next.validity }));
  }, [tab]);
  const latest = React.useRef(applied);
  latest.current = applied;
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const v = (k: string) => (filter.getFilterItemValue<string>(k) ?? "").trim();
        commit({
          ...latest.current,
          state: ((filter.getFilterItemValue<string[]>("state") ?? [])[0] as StateFilter | undefined) ?? "open",
          severity: (filter.getFilterItemValue<string[]>("severity") ?? [])[0] as RatedSeverity | undefined,
          tool: v("tool"), rule: v("rule"), text: v("text"),
          ecosystem: (filter.getFilterItemValue<string[]>("ecosystem") ?? [])[0] ?? "",
          package: v("package"),
          validity: (filter.getFilterItemValue<string[]>("validity") ?? [])[0] as SecretValidity | undefined,
        });
      }, DEBOUNCE_MS);
    };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => { clearTimeout(t); filter.unsubscribe(onChange, FILTER_CHANGE_EVENT); };
  }, [filter, commit]);

  // text and rule are applied to the loaded rows (GitHub cannot search these endpoints); the rest goes to the server.
  const server: SecurityFilters = React.useMemo(() => ({ state: applied.state, severity: kind === "secret" ? undefined : applied.severity, branch: kind === "code" ? applied.branch || undefined : undefined, tool: kind === "code" ? applied.tool || undefined : undefined,
    // Dependabot takes ecosystem and package, secret scanning takes validity (securityRequests.ts drops them for the other sources anyway).
    ecosystem: kind === "dependabot" ? applied.ecosystem || undefined : undefined,
    package: kind === "dependabot" ? applied.package || undefined : undefined,
    validity: kind === "secret" ? applied.validity : undefined }), [applied, kind]);
  const serverKey = JSON.stringify(server);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    setMore({ busy: false, err: false });
    listAlerts(kind, repo, server).then((page) => !dead && setLoad({ t: "ready", page }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [kind, repo, serverKey, reload, props.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    if (load.t !== "ready" || !load.page.next || more.busy) return;
    const prev = load.page;
    setMore({ busy: true, err: false });
    listAlerts(kind, repo, server, prev.next).then(
      (p) => { setLoad({ t: "ready", page: { rows: [...prev.rows, ...p.rows], next: p.next } }); setMore({ busy: false, err: false }); },
      () => setMore({ busy: false, err: true })
    );
  };

  const open = React.useCallback((n: number) => gotoHash(alertDetailHash(repo, kind, n)), [repo, kind]);
  const cols = React.useMemo(() => columns(kind, repo, open), [kind, repo, open]);
  const rows = React.useMemo(() => (load.t === "ready" ? filterRows(load.page.rows, { text: applied.text, rule: kind === "code" ? applied.rule : undefined }) : []), [load, applied.text, applied.rule, kind]);
  const provider = React.useMemo(() => new ArrayItemProvider(rows), [rows]);
  const filtered = applied.text || applied.rule || applied.severity || applied.branch || applied.tool || applied.state !== "open" || (kind === "dependabot" && (applied.ecosystem || applied.package)) || (kind === "secret" && applied.validity);

  return (
    <>
      <FilterBar filter={filter} searchRoleAriaLabel="Filter alerts">
        <KeywordFilterBarItem filterItemKey="text" placeholder={kind === "secret" ? "Search secrets" : "Search alerts"} />
        <DropdownFilterBarItem filterItemKey="state" placeholder="State" items={STATES} selection={stateSel} enforceSingleSelect showFilterBox={false} ariaLabel="State" />
        {kind !== "secret" && <DropdownFilterBarItem filterItemKey="severity" placeholder="Severity" items={SEVERITIES.filter((s) => kind === "code" || s !== "Note").map((s) => ({ id: s, text: s }))} selection={sevSel} enforceSingleSelect showFilterBox={false} ariaLabel="Severity" />}
        {kind === "code" && <BranchItem filterItemKey="branch" repo={repo} branch={applied.branch} onPick={(b) => commit({ ...latest.current, branch: b })} />}
        {kind === "code" && <TextFilterBarItem filterItemKey="tool" placeholder="Tool" ariaLabel="Tool" />}
        {kind === "code" && <TextFilterBarItem filterItemKey="rule" placeholder="Rule" ariaLabel="Rule" />}
        {kind === "dependabot" && <DropdownFilterBarItem filterItemKey="ecosystem" placeholder="Ecosystem" items={ECOSYSTEMS} selection={ecoSel} enforceSingleSelect showFilterBox={false} ariaLabel="Ecosystem" />}
        {kind === "dependabot" && <TextFilterBarItem filterItemKey="package" placeholder="Package" ariaLabel="Package name" />}
        {kind === "secret" && <DropdownFilterBarItem filterItemKey="validity" placeholder="Validity" items={VALIDITIES} selection={valSel} enforceSingleSelect showFilterBox={false} ariaLabel="Validity" />}
      </FilterBar>
      {load.t === "loading" && (
        <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
          <Table<AlertRow> ariaLabel="Loading alerts" role="table" columns={cols} itemProvider={skeletonRows<AlertRow>()} spacerWidth={8} />
        </Card>
      )}
      {load.t === "error" && <Unavailable kind={kind} repo={repo} err={load.err} retry={() => setReload((n) => n + 1)} signIn={() => void props.signIn()} busy={props.busy} />}
      {load.t === "ready" && !rows.length && (
        <ZeroData
          iconProps={{ iconName: filtered ? "Filter" : "Shield" }}
          imageAltText=""
          primaryText={filtered ? "No matching alerts" : kind === "dependabot" ? "No open dependency alerts" : kind === "code" ? "No open code scanning alerts" : "No open secrets"}
          secondaryText={filtered ? (load.page.next ? "Load more alerts, or change the filters." : "Clear or change the filters to see more.") : undefined}
        />
      )}
      {load.t === "ready" && rows.length > 0 && (
        <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
          <Table<AlertRow> ariaLabel={`${TABS.find((t) => t.id === tab)!.name} alerts`} role="table" columns={cols} itemProvider={provider} spacerWidth={8} singleClickActivation onActivate={(_e, r) => open(r.data.number)} />
        </Card>
      )}
      {load.t === "ready" && load.page.next && (
        <div className="gh-sec-more flex-row flex-center">
          <Button text={more.busy ? "Loading" : "Load more"} disabled={more.busy} onClick={loadMore} />
          {more.err && <span className="gh-sec-more-err" role="alert">Could not load more alerts.</span>}
        </div>
      )}
    </>
  );
}

// ---------- one alert ----------

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="gh-sec-fact flex-row"><span className="gh-sec-fact-label secondary-text">{label}</span><span className="gh-sec-fact-value">{children}</span></div>
);

function Snippet({ lines, path }: { lines: SnippetLine[]; path: string }) {
  if (!lines.length) return <div className="secondary-text gh-sec-plain">The file has changed since this alert was found, so its code cannot be shown here.</div>;
  return (
    <table className="gh-sec-snippet" aria-label={`Code from ${path}`}>
      <tbody>
        {lines.map((l) => (
          <tr key={l.number} className={l.target ? "gh-sec-target" : undefined}>
            <td className="gh-sec-ln">{l.number}</td>
            <td className="gh-sec-code"><code>{l.text || " "}</code>{l.target && <span className="gh-sr-only"> (flagged line)</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const where = (loc?: { path: string; startLine?: number; endLine?: number }) =>
  !loc ? "" : loc.startLine ? `${loc.path}:${loc.startLine}${loc.endLine && loc.endLine !== loc.startLine ? `-${loc.endLine}` : ""}` : loc.path;

const locText = (l: SecretLocation) => (l.path ? where({ path: l.path, startLine: l.startLine, endLine: l.endLine }) : l.type.replace(/_/g, " "));

/** The places a code scanning alert occurs: Enter or a click on a row shows that place. */
function InstancesTable({ instances, pick }: { instances: AlertInstance[]; pick: (i: AlertInstance) => void }) {
  const provider = React.useMemo(() => new ArrayItemProvider(instances), [instances]);
  const cols = React.useMemo<ITableColumn<AlertInstance>[]>(() => {
    const text = (id: string, name: string, width: number, f: (i: AlertInstance) => string, mono = false): ITableColumn<AlertInstance> => ({
      id, name, width,
      renderCell: (_r, columnIndex, tableColumn, i) => <SimpleTableCell key={id} columnIndex={columnIndex} tableColumn={tableColumn}><span className={mono ? "monospaced-xs text-ellipsis" : "text-ellipsis"}>{f(i)}</span></SimpleTableCell>,
    });
    return [
      text("branch", "Branch", -30, (i) => i.ref.replace(/^refs\/heads\//, "")),
      text("commit", "Commit", 100, (i) => i.commitSha.slice(0, 8), true),
      text("location", "Location", -70, (i) => where(i.location), true),
    ];
  }, []);
  return <Table<AlertInstance> ariaLabel="Instances of this alert" role="table" columns={cols} itemProvider={provider} singleClickActivation onActivate={(_e, r) => pick(r.data)} />;
}

/** Where a secret was found; a commit location links to GitHub. */
function LocationsTable({ locations }: { locations: SecretLocation[] }) {
  const provider = React.useMemo(() => new ArrayItemProvider(locations), [locations]);
  const cols = React.useMemo<ITableColumn<SecretLocation>[]>(() => [
    {
      id: "location", name: "Location", width: -70,
      renderCell: (_r, columnIndex, tableColumn, l) => (
        <SimpleTableCell key="location" columnIndex={columnIndex} tableColumn={tableColumn}>
          {l.url ? <Link className="text-ellipsis" href={l.url} target="_blank" rel="noopener noreferrer">{locText(l)}</Link> : <span className="text-ellipsis">{locText(l)}</span>}
        </SimpleTableCell>
      ),
    },
    {
      id: "type", name: "Found in", width: -30,
      renderCell: (_r, columnIndex, tableColumn, l) => <SimpleTableCell key="type" columnIndex={columnIndex} tableColumn={tableColumn}><span className="secondary-text">{l.type.replace(/_/g, " ")}</span></SimpleTableCell>,
    },
  ], []);
  return <Table<SecretLocation> ariaLabel="Where the secret was found" role="table" columns={cols} itemProvider={provider} />;
}

function DismissDialog({ kind, busy, error, clearError, submit, close }: { kind: AlertKind; busy: boolean; error: string | null; clearError: () => void; submit: (reason: string, comment: string) => void; close: () => void }) {
  const reasons = dismissReasons(kind);
  const [reason, setReason] = React.useState("");
  const [comment, setComment] = React.useState("");
  const secret = kind === "secret";
  const over = !secret && comment.length > MAX_DISMISS_COMMENT;
  return (
    <Dialog
      titleProps={{ text: secret ? "Resolve alert" : "Dismiss alert" }}
      onDismiss={close}
      footerButtonProps={[{ text: "Cancel", onClick: close }, { text: secret ? "Resolve alert" : "Dismiss alert", primary: true, disabled: !reason || over || busy, onClick: () => submit(reason, comment) }]}
    >
      <div className="gh-dialog-form flex-column">
        {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={clearError}>{error}</MessageCard>}
        <FormItem label={secret ? "Resolution" : "Reason"} required>
          <Dropdown ariaLabel={secret ? "Resolution" : "Reason"} placeholder="Select a reason" items={reasons.map((r) => ({ id: r.value, text: r.label }))} onSelect={(_e, i) => setReason(i.id)} />
        </FormItem>
        <FormItem label="Comment (optional)" error={over} message={secret ? undefined : `${comment.length} / ${MAX_DISMISS_COMMENT}`}>
          <TextField value={comment} onChange={(_e, v) => setComment(v)} multiline rows={3} ariaLabel="Comment" maxLength={secret ? undefined : MAX_DISMISS_COMMENT + 20 /* typing past the limit shows the counter in error rather than silently cutting */} />
        </FormItem>
      </div>
    </Dialog>
  );
}

function AlertPage({ repo, kind, number, props, onChanged }: { repo: string; kind: AlertKind; number: number; props: HubProps; onChanged: () => void }) {
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: DetailData }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [picked, setPicked] = React.useState<AlertInstance | undefined>();
  const [snippet, setSnippet] = React.useState<SnippetLine[] | undefined>();
  const [dialog, setDialog] = React.useState(false);
  const [writes, setWrites] = React.useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  React.useEffect(() => {
    let dead = false;
    loadDetail(kind, repo, number).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [kind, repo, number, reload, props.signedIn]);

  const v = data.t === "ready" ? data.v : undefined;
  const shown = picked ?? v?.latest;
  React.useEffect(() => {
    setSnippet(undefined);
    if (kind !== "code" || !shown) return;
    let dead = false;
    loadSnippet(repo, shown).then((s) => !dead && setSnippet(s));
    return () => { dead = true; };
  }, [kind, repo, shown?.commitSha, shown?.location?.path, shown?.location?.startLine]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setWrites({ busy: true, error: null });
    try {
      await fn();
      setDialog(false);
      setWrites({ busy: false, error: null });
      setReload((n) => n + 1); // refetch: GitHub's answer, not our guess, is what the page shows
      onChanged();
    } catch (e) {
      setWrites({ busy: false, error: writeErrorText(kind, repo, e) });
    }
  };

  const d = v?.detail;
  const open = d?.state === "Open";
  const canReopen = d && (d.state === "Dismissed" || d.state === "AutoDismissed" || d.state === "Resolved");
  const reasonLabel = (r: string) => (r === "auto_dismissed" ? "Auto-dismissed" : dismissReasons(kind).find((x) => x.value === r)?.label ?? r);
  const secret = kind === "secret";

  const bar = [
    ...(d ? [{ id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: d.url, target: "_blank", important: true }] : []),
    ...(open ? [{ id: "dismiss", text: secret ? "Resolve alert" : "Dismiss alert", iconProps: { iconName: "Cancel" }, important: true, disabled: writes.busy, onActivate: () => { setWrites({ busy: false, error: null }); setDialog(true); } }] : []),
    ...(canReopen ? [{ id: "reopen", text: "Reopen alert", iconProps: { iconName: "Undo" }, important: true, disabled: writes.busy, onActivate: () => void run(() => reopenAlert(kind, repo, number)) }] : []),
  ];

  return (
    <>
      <div className="gh-sec-crumb">
        <Link className="body-s" href={serializeSecurity({ repo, tab: tabForKind(kind) })} onClick={(e) => { e.preventDefault(); gotoHash(serializeSecurity({ repo, tab: tabForKind(kind) })); }}>Back to {TABS.find((t) => t.id === tabForKind(kind))!.name.toLowerCase()} alerts</Link>
      </div>
      <Header className="gh-sec-detail-header" title={d?.title ?? `Alert #${number}`} titleSize={TitleSize.Large} titleAriaLevel={2} commandBarItems={bar} />
      <div className="page-content gh-pr-body flex-column">
        {writes.error && !dialog && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setWrites({ busy: false, error: null })}>{writes.error}</MessageCard>}
        {data.t === "loading" && <Loading label="Loading alert" />}
        {data.t === "error" && <Unavailable kind={kind} repo={repo} err={data.err} retry={() => setReload((n) => n + 1)} signIn={() => void props.signIn()} busy={props.busy} />}
        {v && d && (
          <>
            <Card className="gh-pr-card" titleProps={{ text: "Details" }}>
              <div className="flex-column gh-sec-facts">
                {!secret && <Row label="Severity"><SeverityPill severity={d.severity} /></Row>}
                <Row label="State">{STATE_TEXT[d.state]}{d.dismissal ? ` (${reasonLabel(d.dismissal.reason)}${d.dismissal.by ? ` by ${d.dismissal.by}` : ""})` : ""}</Row>
                {d.dismissal?.comment && <Row label="Comment">{d.dismissal.comment}</Row>}
                <Row label="First detected"><RelDate date={d.firstDetected} /></Row>
                {d.fixedAt && <Row label="Fixed"><RelDate date={d.fixedAt} /></Row>}
                {d.package && <Row label="Package">{d.package.ecosystem} / {d.package.name}{d.package.scope ? ` (${d.package.scope})` : ""}</Row>}
                {d.package && <Row label="Manifest"><span className="monospaced-xs">{d.package.manifestPath}</span></Row>}
                {d.vulnerableRange && <Row label="Vulnerable versions"><span className="monospaced-xs">{d.vulnerableRange}</span></Row>}
                {kind === "dependabot" && <Row label="First patched version">{d.patchedVersion ?? "No patched version yet"}</Row>}
                {d.tool && <Row label="Tool">{d.tool}</Row>}
                {kind === "code" && d.ruleId && <Row label="Rule"><span className="monospaced-xs">{d.ruleId}</span></Row>}
                {secret && d.ruleId && <Row label="Secret type"><span className="monospaced-xs">{d.ruleId}</span></Row>}
                {secret && d.validity && <Row label="Validity">{d.validity}</Row>}
                {d.cwes.length > 0 && <Row label="CWE">{d.cwes.join(", ")}</Row>}
                {d.cves.length > 0 && <Row label="CVE">{d.cves.join(", ")}</Row>}
              </div>
            </Card>

            {kind === "code" && (
              <Card className="gh-pr-card" titleProps={{ text: "Location" }}>
                <div className="flex-column gh-sec-loc">
                  <span className="monospaced-xs">{where(shown?.location ?? d.place)}</span>
                  {d.message && <span className="secondary-text">{d.message}</span>}
                  {shown?.location && (snippet ? <Snippet lines={snippet} path={shown.location.path} /> : <Loading label="Loading code" />)}
                </div>
              </Card>
            )}
            {kind === "code" && v.instances.length > 1 && (
              <Card className="gh-pr-card" titleProps={{ text: `Instances (${v.instances.length})` }}>
                <InstancesTable instances={v.instances} pick={setPicked} />
              </Card>
            )}

            <Card className="gh-pr-card" titleProps={{ text: "Description" }}>
              <MarkdownText repo={repo} text={d.description} go={props.go} />
            </Card>

            <Card className="gh-pr-card" titleProps={{ text: "Recommendation" }}>
              {kind === "code" ? <MarkdownText repo={repo} text={d.remediation} go={props.go} /> : <div className="gh-sec-plain">{d.remediation}</div>}
            </Card>

            {secret && (
              <Card className="gh-pr-card" titleProps={{ text: "Locations" }}>
                <div className="gh-sec-fill flex-column">
                  {v.locations.length ? (
                    <LocationsTable locations={v.locations} />
                  ) : <div className="secondary-text gh-sec-plain">No locations were returned.</div>}
                  <div className="secondary-text body-s gh-sec-plain">The secret itself is never shown here. Open the alert on GitHub to see it if you need to.</div>
                </div>
              </Card>
            )}

            {d.references.length > 0 && (
              <Card className="gh-pr-card" titleProps={{ text: "References" }}>
                <div className="gh-sec-list gh-sec-fill flex-column" role="group" aria-label="References">
                  {d.references.map((r) => <Link key={r} href={r} target="_blank" rel="noopener noreferrer">{r}</Link>)}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
      {dialog && (
        <DismissDialog
          kind={kind}
          busy={writes.busy}
          error={writes.error}
          clearError={() => setWrites({ busy: false, error: null })}
          close={() => { if (!writes.busy) { setDialog(false); setWrites({ busy: false, error: null }); } }}
          submit={(reason, comment) => void run(() => dismissAlert(kind, repo, number, reason, comment))}
        />
      )}
    </>
  );
}

// ---------- the hub ----------

function SecurityPage({ repo, props }: { repo: string; props: HubProps }) {
  const { security } = useHashExtras(); // BrowseState drops view=security, so the page is routed on its own parse of the hash
  const sec = security && security.repo === repo ? security : null;
  const tab: SecTab = sec?.tab ?? "dependencies";
  const kind = kindForTab(tab);
  const [counts, setCounts] = React.useState<Partial<Record<AlertKind, AlertCount>>>({});
  const [tick, setTick] = React.useState(0);
  const branch = sec?.branch;
  React.useEffect(() => {
    let dead = false;
    setCounts({});
    for (const k of ["dependabot", "code", "secret"] as const) openCount(k, repo, k === "code" ? branch : undefined).then((c) => !dead && c && setCounts((o) => ({ ...o, [k]: c })));
    return () => { dead = true; };
  }, [repo, branch, tick, props.signedIn]);

  const go = (r: string) => gotoHash(serializeSecurity({ repo: r, tab }));
  return (
    <>
      <Header
        className="gh-hub-header gh-act-header"
        title="Advanced Security"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: `https://github.com/${repo}/security`, target: "_blank", important: true },
          ...props.commandBarItems.map((c) => ({ ...c, important: false })),
        ]}
      >
        {titleSwitcher(repo, props.openSwitch, go)}
      </Header>
      <TabBar ariaLabel="Advanced Security" selectedTabId={tab} onSelectedTabChanged={(id) => gotoHash(serializeSecurity({ repo, tab: id as SecTab }))} tabSize={TabSize.Tall} disableSticky>
        {TABS.map((t) => {
          const c = counts[kindForTab(t.id)];
          return <Tab key={t.id} id={t.id} name={t.name} renderBadge={c ? () => <TabBadge>{c.label}</TabBadge> : undefined} />;
        })}
      </TabBar>
      {sec?.alert ? (
        <AlertPage key={`${repo}/${tab}/${sec.alert}`} repo={repo} kind={kind} number={sec.alert} props={props} onChanged={() => setTick((n) => n + 1)} />
      ) : (
        <div className="page-content page-content-top gh-pr-body flex-column">
          <AlertList key={`${repo}/${tab}`} repo={repo} kind={kind} seed={sec} props={props} />
        </div>
      )}
    </>
  );
}

export function SecurityHub(props: HubProps) {
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => <SecurityPage repo={repo} props={props} />}
    </RepoHubPage>
  );
}
