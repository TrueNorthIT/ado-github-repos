// Code search (Files hub), like native Repos' Code search: a search box and filters, results grouped by file with the matching lines
// highlighted, and a preview of the selected file with every hit highlighted. Backed by REST GET /search/code (text-match media type).
// The hash keys (search, searchAll, searchPath, searchExt, searchHit) are lib/searchHash.ts; the query planning and limits are lib/codeSearch.ts.
import * as React from "react";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Page } from "azure-devops-ui/Page";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Card } from "azure-devops-ui/Card";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Splitter, SplitterElementPosition } from "azure-devops-ui/Splitter";
import { Table, ITableColumn, SimpleTableCell, TableColumnLayout } from "azure-devops-ui/Table";
import { ListSelection } from "azure-devops-ui/List";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Link } from "azure-devops-ui/Link";
import { Button } from "azure-devops-ui/Button";
import { skeletonRows } from "./RepoHub";
import { loadMonaco, useConnectedRepos } from "./Browser";
import { FileIcon } from "./fileIcons";
import { getRaw, getRepo, searchCode } from "./githubBrowse";
import { gotoHash, patchHash } from "./hostNav";
import { watchTheme } from "./theme";
import { serialize, type BrowseState } from "./lib/browseState";
import { applySearch, type SearchHashState } from "./lib/searchHash";
import { classifyFile, monacoLanguage } from "./lib/fileKind";
import {
  PER_PAGE, RateWindow, classifyFailure, findHitRanges, fragmentLines, githubSearchUrl, mergeBatches, planSearch, splitBatch,
  type BatchResult, type SearchBatch, type SearchFailure, type SearchHit, type SearchInput, type SearchOutcome,
} from "./lib/codeSearch";
import "./codeSearch.css";

// One allowance for the whole page: GitHub counts code search requests per user, whichever repo they name.
const window10 = new RateWindow();
/** Set from a GitHub rate-limit answer: no request goes out before then. */
let blockedUntil = 0;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; outcome: SearchOutcome }>();

type Load =
  | { t: "idle"; problem?: string }
  | { t: "loading" }
  | { t: "error"; failure: SearchFailure; local?: boolean }
  | { t: "ready"; outcome: SearchOutcome };

/** Runs the batches one after another (bursts trip GitHub's secondary limit), stopping at a rate-limit answer. */
async function runSearch(input: SearchInput): Promise<Load> {
  const plan = planSearch(input);
  if (plan.problem) return { t: "idle", problem: plan.problem };
  const key = JSON.stringify(plan.batches.map((b) => b.q));
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { t: "ready", outcome: withSkipped(hit.outcome, plan.skipped) };
  if (Date.now() < blockedUntil) return { t: "error", failure: { kind: "rateLimit", resetAt: new Date(blockedUntil) }, local: true };
  if (!window10.canSpend(plan.batches.length)) return { t: "error", failure: { kind: "rateLimit", resetAt: window10.freeAt(plan.batches.length) }, local: true };
  const results: BatchResult[] = [];
  let stop = false;
  const run = async (batch: SearchBatch) => {
    window10.spend(1);
    try {
      results.push({ batch, ok: await searchCode(batch.q, 1, PER_PAGE) });
    } catch (e) {
      const err = classifyFailure(e as never);
      if (err.kind === "rateLimit" || err.kind === "auth") {
        blockedUntil = err.kind === "rateLimit" ? (err.resetAt?.getTime() ?? Date.now() + 60_000) : 0;
        stop = true;
      }
      // One repository GitHub can't search (deleted, or no access) fails the whole query with a 422: split the batch and try the halves,
      // while the minute's allowance lasts, so the others are still searched.
      const halves = err.kind === "validation" ? splitBatch(batch) : undefined;
      if (halves && window10.canSpend(2)) for (const h of halves) { if (!stop) await run(h); }
      else results.push({ batch, err });
    }
  };
  for (const batch of plan.batches) { if (!stop) await run(batch); }
  const outcome = mergeBatches(results);
  if (!results.some((r) => r.ok)) return { t: "error", failure: outcome.failed[0]?.err ?? { kind: "other" } };
  if (!outcome.failed.length) cache.set(key, { at: Date.now(), outcome });
  return { t: "ready", outcome: withSkipped(outcome, plan.skipped) };
}

const withSkipped = (o: SearchOutcome, skipped: string[]): SearchOutcome =>
  skipped.length ? { ...o, failed: [...o.failed, { repos: skipped, err: { kind: "other", message: "skipped" } }] } : o;

function FailureCard({ failure, local, signIn, busy, retry }: { failure: SearchFailure; local?: boolean; signIn: () => void; busy: boolean; retry: () => void }) {
  if (failure.kind === "auth")
    return <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in with GitHub", onClick: signIn, primary: true, disabled: busy }]}>Sign in with GitHub to search code.</MessageCard>;
  if (failure.kind === "rateLimit") {
    const at = failure.resetAt ? ` Try again after ${failure.resetAt.toLocaleTimeString()}.` : " Wait a minute, then try again.";
    return (
      <MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Try again", onClick: retry }]}>
        {local ? "GitHub allows about 10 code searches a minute, and this page has used them." : "GitHub's code search rate limit has been reached."}{at}
      </MessageCard>
    );
  }
  if (failure.kind === "validation")
    return (
      <MessageCard severity={MessageCardSeverity.Warning}>
        GitHub could not run this search{failure.message && failure.message !== "Validation Failed" ? `: ${failure.message}` : ""}. Check the search text and filters. Code search needs at least one word to look for, and every repository searched must be one you can read.
      </MessageCard>
    );
  if (failure.kind === "access")
    return <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Sign in again", onClick: signIn, disabled: busy }]}>You don't have access to search this code, or the GitHub App lacks Contents permission.</MessageCard>;
  return <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: retry }]}>Could not search GitHub.</MessageCard>;
}

// ---------- filters ----------

const SCOPE_ITEMS = [{ id: "repo", text: "This repository" }, { id: "all", text: "All connected repositories" }];
const filterState = (st: SearchHashState) => ({ text: { value: st.text }, path: { value: st.path ?? "" }, ext: { value: st.ext ?? "" }, scope: { value: [st.all ? "all" : "repo"] } });

/** The search box and filters. Text fields change only on Enter (each search spends GitHub's small allowance); the scope applies at once. */
function SearchBar({ st, onSearch }: { st: SearchHashState; onSearch: (next: Omit<SearchHashState, "repo">) => void }) {
  const filter = React.useMemo(() => { const f = new Filter(); f.setState(filterState(st), true); return f; }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the hash seeds it; see below
  const scope = React.useMemo(() => new DropdownSelection(), []);
  const latest = React.useRef(onSearch);
  latest.current = onSearch;
  // Back/forward or a new search from the Files page: put the hash's values in the fields without firing a search.
  React.useEffect(() => {
    filter.setState(filterState(st), true);
    scope.select(st.all ? 1 : 0);
  }, [st.text, st.path, st.ext, st.all]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const onChange = () => {
      const v = (k: string) => (filter.getFilterItemValue<string>(k) ?? "").trim();
      latest.current({ text: v("text"), path: v("path") || undefined, ext: v("ext") || undefined, all: (filter.getFilterItemValue<string[]>("scope") ?? [])[0] === "all" || undefined });
    };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => filter.unsubscribe(onChange, FILTER_CHANGE_EVENT);
  }, [filter]);
  return (
    <FilterBar filter={filter} searchRoleAriaLabel="Search code" className="gh-search-bar">
      <TextFilterBarItem filterItemKey="text" placeholder="Search code (press Enter)" ariaLabel="Search code. Press Enter to search." onlyChangeOnEnter clearable />
      <DropdownFilterBarItem filterItemKey="scope" placeholder="Scope" items={SCOPE_ITEMS} selection={scope} enforceSingleSelect showFilterBox={false} ariaLabel="Repositories to search" />
      <TextFilterBarItem filterItemKey="path" placeholder="Path" ariaLabel="Path filter, for example src/util. Press Enter to apply." onlyChangeOnEnter />
      <TextFilterBarItem filterItemKey="ext" placeholder="Extension" ariaLabel="File extension filter, for example ts. Press Enter to apply." onlyChangeOnEnter />
    </FilterBar>
  );
}

// ---------- results ----------

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

function ResultCell({ h, showRepo }: { h: SearchHit; showRepo: boolean }) {
  const lines = h.fragments.flatMap((f) => fragmentLines(f, 2)).slice(0, 4);
  const where = [showRepo ? h.repo : "", dirOf(h.path)].filter(Boolean).join(" / ");
  return (
    <div className="gh-search-result flex-column">
      <div className="gh-search-title flex-row flex-center">
        <span className="gh-entry-icon"><FileIcon name={h.name} kind="file" /></span>
        <span className="font-weight-semibold text-ellipsis">{h.name}</span>
        {h.matchCount > 0 && <Pill className="gh-search-count" size={PillSize.compact} variant={PillVariant.standard}>{h.matchCount}</Pill>}
      </div>
      {where && <div className="secondary-text text-ellipsis gh-search-where">{where}</div>}
      {/* Hand-rolled: the matched text inside a fragment is marked with spans from text_matches indices; no azure-devops-ui component highlights ranges in text. */}
      {lines.map((segs, i) => (
        <div key={i} className="gh-search-line text-ellipsis">
          {segs.map((s, j) => (s.hit ? <span key={j} className="gh-search-mark">{s.text}</span> : <React.Fragment key={j}>{s.text}</React.Fragment>))}
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ hits, selected, onSelect, showRepo }: { hits: SearchHit[] | undefined; selected?: string; onSelect: (h: SearchHit) => void; showRepo: boolean }) {
  const selection = React.useMemo(() => new ListSelection({ selectOnFocus: false }), []);
  React.useEffect(() => {
    const i = hits?.findIndex((h) => h.key === selected) ?? -1;
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [hits, selected, selection]);
  const provider = React.useMemo(() => (hits ? new ArrayItemProvider(hits) : skeletonRows<SearchHit>(6)), [hits, showRepo]);
  const columns = React.useMemo<ITableColumn<SearchHit>[]>(() => [{
    id: "file",
    name: "Results",
    width: -100,
    columnLayout: TableColumnLayout.twoLinePrefix,
    renderCell: (_r, columnIndex, tableColumn, h) => (
      <SimpleTableCell key="file" columnIndex={columnIndex} tableColumn={tableColumn} contentClassName="gh-search-cell">
        <ResultCell h={h} showRepo={showRepo} />
      </SimpleTableCell>
    ),
  }], [showRepo]);
  return (
    <Table<SearchHit>
      ariaLabel={hits ? "Search results" : "Searching"}
      className="gh-search-table"
      columns={columns}
      itemProvider={provider}
      selection={selection}
      singleClickActivation
      onSelect={(_e, row) => onSelect(row.data)}
      onActivate={(_e, row) => onSelect(row.data)}
      showHeader={false}
      rowHeight={96}
      role="listbox"
    />
  );
}

// ---------- preview ----------

type Preview = { t: "loading" } | { t: "text"; text: string } | { t: "cant"; why: string } | { t: "error" };

function SearchPreview({ hit, dark }: { hit: SearchHit; dark: boolean }) {
  const [p, setP] = React.useState<Preview>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    setP({ t: "loading" });
    (async () => {
      // Search results come from the default branch; the item's contents URL names the commit it was indexed at.
      const ref = hit.ref || (await getRepo(hit.repo)).defaultBranch;
      const bytes = await getRaw(hit.repo, ref, hit.path);
      const kind = classifyFile(hit.name, bytes.byteLength, new Uint8Array(bytes, 0, Math.min(8000, bytes.byteLength)));
      if (dead) return;
      if (kind === "text" || kind === "markdown") setP({ t: "text", text: new TextDecoder().decode(bytes) });
      else setP({ t: "cant", why: kind === "tooLarge" ? "This file is too large to preview." : kind === "image" ? "This is an image, so there is no text to highlight." : "This is a binary file." });
    })().catch(() => !dead && setP({ t: "error" }));
    return () => { dead = true; };
  }, [hit.key, hit.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const text = p.t === "text" ? p.text : undefined;
  const ranges = React.useMemo(() => (text === undefined ? [] : findHitRanges(text, hit.terms)), [text, hit.terms]);
  React.useEffect(() => {
    if (text === undefined) return;
    let dead = false;
    let ed: { dispose(): void } | undefined;
    loadMonaco()
      .then((m) => { if (!dead && box.current) ed = m.createSearchViewer(box.current, text, monacoLanguage(hit.name), dark, hit.path, ranges); })
      .catch(() => !dead && setFailed(true));
    return () => { dead = true; ed?.dispose(); };
  }, [text, ranges]); // eslint-disable-line react-hooks/exhaustive-deps -- the theme is switched below without recreating the editor
  React.useEffect(() => { if (text !== undefined) void loadMonaco().then((m) => m.setTheme(dark)); }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  const filesHref = serialize({ repo: hit.repo, path: hit.path });
  return (
    <div className="gh-search-preview flex-column">
      <div className="gh-search-preview-head flex-row flex-center">
        <span className="gh-entry-icon"><FileIcon name={hit.name} kind="file" /></span>
        <div className="flex-column gh-search-preview-name">
          <span className="font-weight-semibold text-ellipsis">{hit.path}</span>
          <span className="secondary-text text-ellipsis">{hit.repo}{text !== undefined ? ` · ${ranges.length} ${ranges.length === 1 ? "hit" : "hits"}` : ""}</span>
        </div>
        <Button text="Open file" iconProps={{ iconName: "Page" }} href={filesHref} onClick={(e) => { if (!(e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); gotoHash(filesHref); } }} />
        <Button text="Open on GitHub" iconProps={{ iconName: "OpenInNewTab" }} href={hit.htmlUrl} target="_blank" rel="noopener noreferrer" subtle />
      </div>
      <Card className="no-padding gh-card-fill gh-search-preview-card" contentProps={{ contentPadding: false }}>
        {p.t === "loading" && <Spinner size={SpinnerSize.large} ariaLabel="Loading the file" className="gh-search-spin" />}
        {p.t === "error" && <div className="gh-search-msg"><MessageCard severity={MessageCardSeverity.Error}>Could not load this file from GitHub.</MessageCard></div>}
        {p.t === "cant" && <div className="gh-search-msg"><MessageCard severity={MessageCardSeverity.Info}>{p.why}</MessageCard></div>}
        {text !== undefined && (failed ? <pre className="gh-plain">{text}</pre> : <div ref={box} className="gh-code" />)}
      </Card>
    </div>
  );
}

// ---------- the page ----------

export function CodeSearchPage({ st, nav, signedIn, signIn, busy }: { st: SearchHashState; nav: BrowseState & { repo: string }; signedIn: boolean; signIn: () => Promise<void>; busy: boolean }) {
  const { repo } = st;
  const connected = useConnectedRepos(repo);
  const repos = st.all ? connected : [repo];
  const [load, setLoad] = React.useState<Load>({ t: "idle" });
  const [retry, setRetry] = React.useState(0);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  const input: SearchInput | undefined = repos && { text: st.text, repos, path: st.path, ext: st.ext };
  const key = JSON.stringify(input ?? null);

  React.useEffect(() => {
    if (!input) return setLoad({ t: "loading" });
    if (!st.text) return setLoad({ t: "idle" });
    if (!signedIn) return setLoad({ t: "error", failure: { kind: "auth" } });
    let dead = false;
    setLoad({ t: "loading" });
    runSearch(input).then((l) => !dead && setLoad(l), () => !dead && setLoad({ t: "error", failure: { kind: "other" } }));
    return () => { dead = true; };
  }, [key, signedIn, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // New searches are history entries (from the hash the Files page was on, so Back returns to it); picking a result only replaces the hash.
  const search = (next: Omit<SearchHashState, "repo">) => gotoHash(applySearch(serialize(nav), next));
  const pick = (h: SearchHit) => patchHash((hash) => applySearch(hash, { ...st, hit: h.key }));
  const back = () => gotoHash(serialize(nav));

  const hits = load.t === "ready" ? load.outcome.hits : undefined;
  const selected = hits?.find((h) => h.key === st.hit) ?? hits?.[0];
  const doSignIn = () => void signIn().then(() => setRetry((n) => n + 1));
  const skipped = load.t === "ready" ? load.outcome.failed.filter((f) => f.err.message === "skipped").flatMap((f) => f.repos) : [];
  const failed = load.t === "ready" ? load.outcome.failed.filter((f) => f.err.message !== "skipped") : [];

  return (
    <Surface background={SurfaceBackground.neutral}>
      <Page className="gh-page gh-search-page flex-grow">
        <Header
          className="gh-hub-header gh-act-header"
          title="Code search"
          titleSize={TitleSize.Large}
          titleAriaLevel={1}
          backButtonProps={{ ariaLabel: "Back to files", onClick: back }}
          description={st.all ? "All connected repositories, default branches" : `${repo}, default branch`}
          commandBarItems={input && st.text ? [{ id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: githubSearchUrl(input), target: "_blank", important: true }] : []}
        />
        <div className="page-content page-content-top gh-search-body flex-column">
          <SearchBar st={st} onSearch={search} />
          {nav.ref && <MessageCard severity={MessageCardSeverity.Info} className="gh-search-note">GitHub's code search covers only the default branch, so these results are not from {nav.ref}.</MessageCard>}
          {load.t === "error" && <FailureCard failure={load.failure} local={load.local} signIn={doSignIn} busy={busy} retry={() => setRetry((n) => n + 1)} />}
          {load.t === "idle" && (load.problem
            ? <MessageCard severity={MessageCardSeverity.Info}>{load.problem}</MessageCard>
            : <ZeroData iconProps={{ iconName: "Search" }} imageAltText="" primaryText="Search the code" secondaryText="Type in the search box and press Enter. Code search covers the default branch of each repository." />)}
          {failed.map((f) => f.err.kind === "validation" ? (
            <MessageCard key={f.repos.join(" ")} severity={MessageCardSeverity.Warning}>
              GitHub could not search {f.repos.join(", ")}: {f.repos.length === 1 ? "it doesn't exist any more, or you don't have access to it" : "one of these doesn't exist any more, or you don't have access to it"}. Results from the other repositories are shown.
            </MessageCard>
          ) : (
            <FailureCard key={f.repos.join(" ")} failure={f.err} signIn={doSignIn} busy={busy} retry={() => setRetry((n) => n + 1)} />
          ))}
          {skipped.length > 0 && <MessageCard severity={MessageCardSeverity.Info}>{skipped.length} {skipped.length === 1 ? "repository was" : "repositories were"} not searched, to stay within GitHub's limits: {skipped.join(", ")}.</MessageCard>}
          {load.t === "ready" && load.outcome.total > load.outcome.hits.length && (
            <MessageCard severity={MessageCardSeverity.Info}>Showing the first {load.outcome.hits.length} of {load.outcome.total} files. Add a path or extension to narrow the search.</MessageCard>
          )}
          {load.t === "ready" && !hits?.length && <ZeroData iconProps={{ iconName: "Search" }} imageAltText="" primaryText="No results" secondaryText="Nothing on the default branch matches. Check the spelling, or clear the path and extension filters." />}
          {(load.t === "loading" || (hits && hits.length > 0)) && (
            <div className="gh-shell gh-search-split">
              <Splitter
                className="bolt-page-grey"
                fixedElement={SplitterElementPosition.Near}
                initialFixedSize={420}
                minFixedSize={260}
                maxFixedSize={800}
                nearElementClassName="gh-left gh-search-left"
                farElementClassName="gh-right gh-search-right"
                onRenderNearElement={() => (
                  <div className="gh-search-list flex-column" aria-label="Search results">
                    {hits && <div className="gh-search-count-line secondary-text">{load.t === "ready" && load.outcome.total === 1 ? "1 file" : `${load.t === "ready" ? load.outcome.total : hits.length} files`}{load.t === "ready" && load.outcome.incomplete ? " (GitHub timed out; results may be incomplete)" : ""}</div>}
                    <ResultsTable hits={hits} selected={selected?.key} onSelect={pick} showRepo={!!st.all} />
                  </div>
                )}
                onRenderFarElement={() => (selected ? <SearchPreview key={selected.key} hit={selected} dark={dark} /> : <div className="gh-search-preview" />)}
              />
            </div>
          )}
          {load.t === "ready" && hits && hits.length > 0 && <div className="gh-search-foot secondary-text">Results are from GitHub's code search index, which can lag behind recent pushes. <Link href="https://docs.github.com/en/search-github/searching-on-github/searching-code" target="_blank" rel="noopener noreferrer">About code search</Link></div>}
        </div>
      </Page>
    </Surface>
  );
}
