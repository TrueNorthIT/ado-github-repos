// The run page's Tests tab: native Pipelines' test summary and results, read from JUnit XML (or TRX) files the run uploaded as artifacts.
// GitHub has no test results API; see lib/testResults.ts and actionsApi.loadTestResults. Nothing is downloaded until the tab is opened.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { ListSelection } from "azure-devops-ui/List";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { SimpleTableCell, Table, TableColumnLayout, type ITableColumn } from "azure-devops-ui/Table";
import { Tab, TabBar } from "azure-devops-ui/Tabs";
import { Tree, ExpandableTreeCell, type ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { loadTestResults, type TestResultsLoad } from "./actionsApi";
import { formatDuration, type Artifact } from "./lib/workflows";
import { groupsWith, repeatedNames, summarise, TEST_SCAN_CAP, testDuration, type TestCase, type TestGroup, type TestOutcome } from "./lib/testResults";
import { formatBytes } from "./lib/releases";
import { skeletonRows } from "./RepoHub";

type Filter = "failed" | "passed" | "other" | "all";
const FILTERS: { id: Filter; name: string; outcomes: TestOutcome[] }[] = [
  { id: "failed", name: "Failed", outcomes: ["failed"] },
  { id: "passed", name: "Passed", outcomes: ["passed"] },
  { id: "other", name: "Others", outcomes: ["other"] },
  { id: "all", name: "All", outcomes: ["failed", "passed", "other"] },
];
const OUTCOME_TEXT: Record<TestOutcome, string> = { passed: "Passed", failed: "Failed", other: "Other" };
const OUTCOME_STATUS = { passed: Statuses.Success, failed: Statuses.Failed, other: Statuses.Skipped } as const;
const runDur = (ms: number | undefined) => (ms === undefined ? "" : ms < 1000 ? `${ms}ms` : formatDuration(ms));

// Results per run and set of artifacts, so going back to the tab does not download again.
const cache = new Map<string, Promise<TestResultsLoad>>();

type Load = { t: "loading" } | { t: "error" } | { t: "ready"; v: TestResultsLoad };

function useTestResults(repo: string, runId: number, artifacts: Artifact[]): Load {
  const key = `${repo}#${runId}#${artifacts.map((a) => `${a.id}${a.expired ? "x" : ""}`).join(",")}`;
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    let p = cache.get(key);
    if (!p) {
      p = loadTestResults(repo, artifacts);
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    p.then((v) => !dead && setLoad({ t: "ready", v }), () => !dead && setLoad({ t: "error" }));
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return load;
}

const EXAMPLE = `- name: Upload test results
  if: \${{ !cancelled() }}
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: junit.xml`;

export function TestsTab({ repo, runId, artifacts, active }: { repo: string; runId: number; artifacts: Artifact[]; active: boolean }) {
  const load = useTestResults(repo, runId, artifacts);
  if (load.t === "loading") return <TestsLoading />;
  if (load.t === "error") return <MessageCard severity={MessageCardSeverity.Error}>Could not read the run's artifacts.</MessageCard>;
  const { reports } = load.v;
  const found = reports.some((r) => r.groups.length);
  // With results shown, an expired artifact is not worth a word; without any, it may be why.
  const skipped = load.v.skipped.filter((s) => !found || s.reason !== "expired");
  const notes = skipped.length > 0 && (
    <MessageCard severity={MessageCardSeverity.Info}>
      {skipped.map((s) => {
        const a = artifacts.find((x) => x.name === s.name);
        return s.reason === "expired" ? `${s.name} has expired.` : s.reason === "tooLarge" ? `${s.name} (${formatBytes(a?.sizeInBytes ?? 0)}) was not read: test results are read from up to ${formatBytes(TEST_SCAN_CAP)} of artifacts.` : `${s.name} could not be read.`;
      }).join(" ")}
    </MessageCard>
  );
  if (!found) {
    return (
      <>
        {notes}
        <Card className="gh-act-card">
          <ZeroData
            className="gh-act-tests-zero"
            iconProps={{ iconName: "TestBeaker" }}
            imageAltText=""
            primaryText={active ? "No test results yet" : "No test results"}
            secondaryText={
              <div className="flex-column gh-act-tests-zero-text">
                <span>Test results come from JUnit XML (or .trx) files that the run uploads as artifacts. {artifacts.length ? "None of this run's artifacts hold one." : "This run has no artifacts."}</span>
                <span>Have your test runner write JUnit XML, then upload it, for example:</span>
                <pre className="gh-act-tests-code">{EXAMPLE}</pre>
              </div>
            }
            renderAction={() => <Link href="https://github.com/actions/upload-artifact#readme" target="_blank" rel="noopener noreferrer">About actions/upload-artifact</Link>}
          />
        </Card>
      </>
    );
  }
  return <Results reports={load.v.reports} notes={notes} />;
}

function TestsLoading() {
  const cols = React.useMemo<ITableColumn<object>[]>(() => [
    { id: "name", name: "Test", width: -70, columnLayout: TableColumnLayout.singleLinePrefix, renderCell: () => null as never },
    { id: "outcome", name: "Outcome", width: -15, renderCell: () => null as never },
    { id: "dur", name: "Duration", width: -15, renderCell: () => null as never },
  ], []);
  return (
    <Card className="gh-act-card" titleProps={{ text: "Reading test results from artifacts" }}>
      <Table<object> ariaLabel="Loading test results" role="table" className="gh-act-jobtable" columns={cols} itemProvider={skeletonRows<object>(6)} showHeader spacerWidth={8} />
    </Card>
  );
}

const Stat = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => (
  <div className="gh-act-stat flex-column">
    <span className="secondary-text">{label}</span>
    <span className="gh-act-stat-value flex-row flex-center">{icon}{value}</span>
  </div>
);

type Node = { kind: "group"; group: TestGroup; key: string } | { kind: "test"; test: TestCase; group: TestGroup; key: string };

function Results({ reports, notes }: { reports: TestResultsLoad["reports"]; notes: React.ReactNode }) {
  const s = React.useMemo(() => summarise(reports), [reports]);
  const [filter, setFilter] = React.useState<Filter>(s.failed ? "failed" : "all");
  const [picked, setPicked] = React.useState<string>();
  const outcomes = FILTERS.find((f) => f.id === filter)!.outcomes;
  const groups = React.useMemo(() => groupsWith(reports, outcomes), [reports, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const repeated = React.useMemo(() => repeatedNames(groups), [groups]);
  const count = (f: Filter) => (f === "failed" ? s.failed : f === "passed" ? s.passed : f === "other" ? s.others : s.total);

  const items = React.useMemo<ITreeItem<Node>[]>(() => groups.map((g, gi) => {
    const gk = `${gi}:${g.source}:${g.name}`;
    return { id: gk, data: { kind: "group", group: g, key: gk }, expanded: true, childItems: g.cases.map((t, ti) => ({ id: `${gk}/${ti}`, data: { kind: "test", test: t, group: g, key: `${gk}/${ti}` } })) };
  }), [groups]);
  const provider = React.useMemo(() => new TreeItemProvider<Node>(items), [items]);
  const selection = React.useMemo(() => new ListSelection({ selectOnFocus: false }), []);
  const current = React.useRef(picked);
  current.current = picked;
  const highlight = React.useCallback(() => {
    const i = provider.value.findIndex((x) => x.underlyingItem.id === current.current);
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [provider, selection]);
  React.useEffect(highlight, [highlight, picked]);
  const sel = React.useMemo(() => {
    for (const it of items) for (const c of it.childItems ?? []) if (c.id === picked) return c.data as Extract<Node, { kind: "test" }>;
    return undefined;
  }, [items, picked]);

  const cols = React.useMemo<ITreeColumn<Node>[]>(() => [
    {
      id: "name", name: "Test", width: -70, hierarchical: true,
      renderCell: (_r, columnIndex, treeColumn, treeItem) => {
        const n = treeItem.underlyingItem.data;
        if (n.kind === "group") {
          const failed = n.group.cases.filter((c) => c.outcome === "failed").length;
          return (
            <ExpandableTreeCell key="name" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
              <Icon iconName="TestBeaker" className="gh-act-tests-icon" />
              <span className="text-ellipsis gh-act-tests-group">{n.group.name}</span>
              <span className="secondary-text gh-act-tests-count">({failed ? `${failed}/${n.group.cases.length} failed` : n.group.cases.length})</span>
              {repeated.has(n.group.name) && <span className="secondary-text text-ellipsis gh-act-tests-source">{n.group.source}</span>}
            </ExpandableTreeCell>
          );
        }
        return (
          <ExpandableTreeCell key="name" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
            <Status {...OUTCOME_STATUS[n.test.outcome]} size={StatusSize.m} ariaLabel={OUTCOME_TEXT[n.test.outcome]} className="gh-act-tests-icon" />
            <Link className="bolt-table-link text-ellipsis" subtle removeUnderline role="presentation" excludeTabStop>{n.test.name}</Link>
          </ExpandableTreeCell>
        );
      },
    },
    {
      id: "outcome", name: "Outcome", width: -15,
      renderCell: (_r, columnIndex, treeColumn, treeItem) => {
        const n = treeItem.underlyingItem.data;
        return <SimpleTableCell key="outcome" columnIndex={columnIndex} tableColumn={treeColumn}>{n.kind === "test" ? n.test.otherKind ?? OUTCOME_TEXT[n.test.outcome] : ""}</SimpleTableCell>;
      },
    },
    {
      id: "dur", name: "Duration", width: -15,
      renderCell: (_r, columnIndex, treeColumn, treeItem) => {
        const n = treeItem.underlyingItem.data;
        const ms = n.kind === "test" ? n.test.durationMs : n.group.cases.some((c) => c.durationMs !== undefined) ? n.group.cases.reduce((a, c) => a + (c.durationMs ?? 0), 0) : undefined;
        return <SimpleTableCell key="dur" columnIndex={columnIndex} tableColumn={treeColumn}><span className="secondary-text">{testDuration(ms)}</span></SimpleTableCell>;
      },
    },
  ], [repeated]);

  return (
    <>
      {notes}
      <Card className="gh-act-card" titleProps={{ text: "Summary" }}>
        <div className="gh-act-stats flex-row flex-wrap">
          <Stat label="Total tests" value={String(s.total)} />
          <Stat label="Passed" value={String(s.passed)} icon={<Status {...Statuses.Success} size={StatusSize.m} ariaLabel="" />} />
          <Stat label="Failed" value={String(s.failed)} icon={<Status {...Statuses.Failed} size={StatusSize.m} ariaLabel="" />} />
          <Stat label="Others" value={String(s.others)} icon={<Status {...Statuses.Skipped} size={StatusSize.m} ariaLabel="" />} />
          <Stat label="Pass percentage" value={s.passPercent === undefined ? "–" : `${s.passPercent}%`} />
          <Stat label="Run duration" value={runDur(s.durationMs) || "–"} icon={<Icon iconName="Clock" />} />
        </div>
      </Card>
      <div className={`gh-act-tests-split${sel ? " gh-act-tests-split-open" : ""}`}>
        <Card className="gh-act-card gh-act-notescard" contentProps={{ contentPadding: false }}>
          <div className="flex-column flex-grow">
            <TabBar ariaLabel="Test outcomes" selectedTabId={filter} onSelectedTabChanged={(id) => { setFilter(id as Filter); setPicked(undefined); }} className="gh-act-innertabs" disableSticky>
              {FILTERS.map((f) => <Tab key={f.id} id={f.id} name={f.name} badgeCount={count(f.id)} />)}
            </TabBar>
            {groups.length ? (
              <Tree<Node>
                key={filter}
                ariaLabel={`Test results, ${FILTERS.find((f) => f.id === filter)!.name.toLowerCase()}`}
                className="gh-act-tests-tree"
                columns={cols}
                itemProvider={provider as any}
                selection={selection}
                onToggle={(_e, ex) => { provider.toggle(ex.underlyingItem as ITreeItem<Node>); highlight(); }}
                onActivate={(_e, row) => {
                  const n = row.data.underlyingItem.data;
                  if (n.kind === "test") setPicked(n.key);
                  else { provider.toggle(row.data.underlyingItem); highlight(); }
                }}
                singleClickActivation
                showHeader
                showLines={false}
                role="treegrid"
              />
            ) : (
              <div className="secondary-text gh-act-empty">No tests with this outcome.</div>
            )}
          </div>
        </Card>
        {sel && <Details node={sel} close={() => setPicked(undefined)} />}
      </div>
    </>
  );
}

function Details({ node, close }: { node: Extract<Node, { kind: "test" }>; close: () => void }) {
  const t = node.test;
  return (
    <Card
      className="gh-act-card gh-act-tests-details"
      titleProps={{ text: t.name, ariaLevel: 3 }}
      headerCommandBarItems={[{ id: "close", ariaLabel: "Close details", iconProps: { iconName: "Cancel" }, important: true, subtle: true, onActivate: close }]}
    >
      <div className="flex-column gh-act-tests-detail-body">
        <div className="gh-act-tests-facts">
          <span className="secondary-text">Outcome</span>
          <span className="flex-row flex-center gh-act-tests-fact"><Status {...OUTCOME_STATUS[t.outcome]} size={StatusSize.s} ariaLabel="" />{t.otherKind ?? OUTCOME_TEXT[t.outcome]}</span>
          <span className="secondary-text">Duration</span>
          <span>{testDuration(t.durationMs) || "–"}</span>
          {t.className && t.className !== t.name && <><span className="secondary-text">Class</span><span className="gh-act-tests-wrap">{t.className}</span></>}
          <span className="secondary-text">Suite</span>
          <span className="gh-act-tests-wrap">{node.group.name}</span>
          <span className="secondary-text">Read from</span>
          <span className="gh-act-tests-wrap">{node.group.source}</span>
        </div>
        {t.message && <section aria-label="Error message"><h4 className="gh-act-tests-h">{t.outcome === "failed" ? "Error message" : "Message"}</h4><pre className="gh-act-tests-pre">{t.message}</pre></section>}
        {t.stackTrace && <section aria-label="Stack trace"><h4 className="gh-act-tests-h">Stack trace</h4><pre className="gh-act-tests-pre">{t.stackTrace}</pre></section>}
      </div>
    </Card>
  );
}
