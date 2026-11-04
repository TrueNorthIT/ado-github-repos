// Test results for the run page's Tests tab. GitHub has no test results API, so they come from report files a workflow uploads as
// artifacts: JUnit XML (pytest, jest-junit, Maven surefire/failsafe, gotestsum, vitest, PHPUnit, ...) and Visual Studio TRX (dotnet test
// --logger trx). Parsing uses DOMParser("application/xml"), which neither runs scripts nor fetches external entities.

export type TestOutcome = "passed" | "failed" | "other";

export interface TestCase {
  name: string;
  /** classname (JUnit) or the test method's class (TRX), when given. */
  className?: string;
  outcome: TestOutcome;
  /** For "other": what it was (Skipped, Not executed, Inconclusive...). */
  otherKind?: string;
  durationMs?: number;
  message?: string;
  stackTrace?: string;
}

/** One test file's suite (a JUnit <testsuite>, or the tests of one class in a TRX). */
export interface TestGroup {
  /** The suite's name, or its file when it names one. */
  name: string;
  /** Where it was read: "artifact/path/in/zip.xml". */
  source: string;
  cases: TestCase[];
}

export interface TestReport {
  format: "junit" | "trx";
  groups: TestGroup[];
  /** The report's own duration (testsuites@time, the sum of suite times, TRX Times), when it says. */
  durationMs?: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  others: number;
  /** passed / (total - others) as a percentage with one decimal place; undefined with nothing run. Native counts others out of it. */
  passPercent?: number;
  durationMs?: number;
}

const seconds = (v: string | null): number | undefined => {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v.replace(/,/g, "")); // some tools write "1,234.5"
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : undefined;
};

const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const text = (el: Element | undefined) => el?.textContent?.trim() || undefined;

/** Splits a failure body into message and stack when the tool gave no message attribute (jest-junit puts both in the text). */
function splitMessage(attr: string | null, body: string | undefined): { message?: string; stackTrace?: string } {
  const a = attr?.trim() || undefined;
  if (a) return { message: a, stackTrace: body && body !== a ? body : undefined };
  if (!body) return {};
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l, i) => i > 0 && /^\s+at\s|^\s+File "|^\S+\.(py|go|rb|php):\d+/.test(l));
  return at > 0 ? { message: lines.slice(0, at).join("\n").trim(), stackTrace: lines.slice(at).join("\n") } : { message: lines[0].trim(), stackTrace: lines.length > 1 ? body : undefined };
}

function junitCase(tc: Element): TestCase {
  const name = tc.getAttribute("name") ?? "(unnamed)";
  const className = tc.getAttribute("classname") || tc.getAttribute("class") || undefined;
  const durationMs = seconds(tc.getAttribute("time"));
  const base = { name, className, durationMs };
  // <failure> and <error> both fail the test (surefire's <rerunFailure> only comes with one of them; <flakyFailure> passed in the end).
  const bad = kids(tc, "failure")[0] ?? kids(tc, "error")[0];
  if (bad) return { ...base, outcome: "failed", ...splitMessage(bad.getAttribute("message"), text(bad)) };
  const skipped = kids(tc, "skipped")[0];
  const status = (tc.getAttribute("status") ?? "").toLowerCase();
  if (skipped || ["skipped", "notrun", "disabled", "ignored"].includes(status) || tc.getAttribute("skipped") === "true") {
    return { ...base, outcome: "other", otherKind: "Skipped", message: skipped?.getAttribute("message")?.trim() || text(skipped) };
  }
  return { ...base, outcome: "passed" };
}

const GENERIC_SUITE = /^(pytest|tests?|default|root|unnamed)$/i;

function parseJUnit(root: Element, source: string): TestReport {
  const groups: TestGroup[] = [];
  // Suites may nest; each testcase belongs to its nearest suite. A suite's name falls back to the file the cases say they are in.
  const walk = (suite: Element, parentFile?: string) => {
    const file = suite.getAttribute("file") || parentFile;
    const cases = kids(suite, "testcase");
    if (cases.length) {
      const name = suite.getAttribute("name") || "";
      if (file || (name && !GENERIC_SUITE.test(name))) groups.push({ name: file || name, source, cases: cases.map(junitCase) });
      else {
        // pytest names its one suite "pytest": split it by each case's file, else its classname (the module), as native's grouping by file reads.
        const by = new Map<string, TestCase[]>();
        for (const tc of cases) {
          const key = tc.getAttribute("file") || tc.getAttribute("classname") || name || source;
          by.set(key, [...(by.get(key) ?? []), junitCase(tc)]);
        }
        for (const [key, list] of by) groups.push({ name: key, source, cases: list });
      }
    }
    for (const s of kids(suite, "testsuite")) walk(s, file);
  };
  // The root is walked as a suite too: Node's built-in junit reporter (node --test --test-reporter=junit) puts its testcases straight under <testsuites>.
  walk(root);
  const suites = root.localName === "testsuite" ? [root] : kids(root, "testsuite");
  const sum = suites.map((s) => seconds(s.getAttribute("time")));
  const durationMs = seconds(root.getAttribute("time")) ?? (sum.length && sum.every((x) => x !== undefined) ? sum.reduce((a, b) => a! + b!, 0) : undefined);
  return { format: "junit", groups, durationMs };
}

/** TRX durations look like "00:00:01.2345678". */
function trxDuration(v: string | null): number | undefined {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v?.trim() ?? "");
  return m ? Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000) : undefined;
}

const TRX_OTHER: Record<string, string> = { notexecuted: "Not executed", inconclusive: "Inconclusive", aborted: "Aborted", timeout: "Timed out", pending: "Pending", disconnected: "Disconnected", warning: "Warning", notrunnable: "Not runnable", inprogress: "In progress" };

function parseTrx(root: Element, source: string): TestReport {
  const all = (el: Element, name: string) => Array.from(el.getElementsByTagNameNS("*", name));
  const classOf = new Map<string, string>();
  for (const t of all(root, "UnitTest")) {
    const m = all(t, "TestMethod")[0];
    const id = t.getAttribute("id");
    if (id && m?.getAttribute("className")) classOf.set(id, m.getAttribute("className")!);
  }
  const byClass = new Map<string, TestCase[]>();
  for (const r of all(root, "UnitTestResult")) {
    const outcome = (r.getAttribute("outcome") ?? "").toLowerCase();
    const className = classOf.get(r.getAttribute("testId") ?? "");
    const info = all(r, "ErrorInfo")[0];
    const c: TestCase = {
      name: r.getAttribute("testName") ?? "(unnamed)",
      className,
      durationMs: trxDuration(r.getAttribute("duration")),
      outcome: outcome === "passed" ? "passed" : outcome === "failed" || outcome === "error" ? "failed" : "other",
      message: text(info && all(info, "Message")[0]),
      stackTrace: text(info && all(info, "StackTrace")[0]),
    };
    if (c.outcome === "other") c.otherKind = TRX_OTHER[outcome] ?? (r.getAttribute("outcome") || "Other");
    const key = className ?? source;
    byClass.set(key, [...(byClass.get(key) ?? []), c]);
  }
  const times = all(root, "Times")[0];
  const start = Date.parse(times?.getAttribute("start") ?? "");
  const finish = Date.parse(times?.getAttribute("finish") ?? "");
  return {
    format: "trx",
    groups: [...byClass].map(([name, cases]) => ({ name, source, cases })),
    durationMs: Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? finish - start : undefined,
  };
}

/** The test report in an XML or TRX file, or null when it is neither JUnit nor TRX (or is not well-formed). `source` labels its groups. */
export function parseTestReport(xml: string, source: string): TestReport | null {
  const head = xml.slice(0, 4096);
  if (!/<(\w+:)?(testsuites|testsuite|TestRun)\b/.test(head)) return null; // cheap check before parsing a large unrelated XML
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length) return null;
  if (root.localName === "testsuites" || root.localName === "testsuite") return parseJUnit(root, source);
  if (root.localName === "TestRun") return parseTrx(root, source);
  return null;
}

/** Totals across reports. The duration is the sum of the reports' own durations, or of the tests' when a report gives none. */
export function summarise(reports: TestReport[]): TestSummary {
  const cases = reports.flatMap((r) => r.groups.flatMap((g) => g.cases));
  const passed = cases.filter((c) => c.outcome === "passed").length;
  const failed = cases.filter((c) => c.outcome === "failed").length;
  const others = cases.length - passed - failed;
  const ran = passed + failed;
  const durations = reports.map((r) => r.durationMs ?? (r.groups.some((g) => g.cases.some((c) => c.durationMs !== undefined)) ? r.groups.reduce((n, g) => n + g.cases.reduce((m, c) => m + (c.durationMs ?? 0), 0), 0) : undefined));
  const known = durations.filter((d): d is number => d !== undefined);
  return {
    total: cases.length,
    passed,
    failed,
    others,
    passPercent: ran ? Math.floor((passed / ran) * 1000) / 10 : undefined,
    durationMs: known.length ? known.reduce((a, b) => a + b, 0) : undefined,
  };
}

/** Groups (suite name + source) holding the tests with the given outcomes, failed groups first, then by name. Empty groups are left out. */
export function groupsWith(reports: TestReport[], outcomes: readonly TestOutcome[]): TestGroup[] {
  const out = reports.flatMap((r) => r.groups).map((g) => ({ ...g, cases: g.cases.filter((c) => outcomes.includes(c.outcome)).sort((a, b) => rank(a) - rank(b)) })).filter((g) => g.cases.length);
  return out.sort((a, b) => Number(!a.cases.some(isFailed)) - Number(!b.cases.some(isFailed)) || a.name.localeCompare(b.name));
}
const isFailed = (c: TestCase) => c.outcome === "failed";
const rank = (c: TestCase) => (c.outcome === "failed" ? 0 : c.outcome === "other" ? 1 : 2);

/** A test's duration as native's test results write it: "0:00:01.503" (hours unpadded, milliseconds always). */
export function testDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const t = Math.round(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${Math.floor(t / 3_600_000)}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}

/** Group names that occur more than once (the same file from two matrix legs), whose rows then also say where they were read. */
export function repeatedNames(groups: TestGroup[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const g of groups) (seen.has(g.name) ? twice : seen).add(g.name);
  return twice;
}

// ---------- which artifacts to read ----------

export const TEST_SCAN_CAP = 20 * 1024 * 1024;

export interface ArtifactInfo { id: number; name: string; sizeInBytes: number; expired: boolean }

/** Artifacts to download for test results, up to `cap` bytes in all: likely names (test, junit, result, report, coverage...) first, then
 *  the smallest. `skipped` lists the rest with why. Expired artifacts cannot be downloaded. */
export function pickArtifacts(artifacts: ArtifactInfo[], cap = TEST_SCAN_CAP): { read: ArtifactInfo[]; skipped: { artifact: ArtifactInfo; reason: "expired" | "tooLarge" }[] } {
  const likely = (a: ArtifactInfo) => /test|junit|xunit|result|report|surefire|trx/i.test(a.name);
  const live = artifacts.filter((a) => !a.expired).sort((a, b) => Number(likely(b)) - Number(likely(a)) || a.sizeInBytes - b.sizeInBytes);
  const read: ArtifactInfo[] = [];
  const skipped: { artifact: ArtifactInfo; reason: "expired" | "tooLarge" }[] = artifacts.filter((a) => a.expired).map((artifact) => ({ artifact, reason: "expired" as const }));
  let used = 0;
  for (const a of live) {
    if (used + a.sizeInBytes <= cap) { read.push(a); used += a.sizeInBytes; }
    else skipped.push({ artifact: a, reason: "tooLarge" });
  }
  return { read, skipped };
}

/** Zip entries worth parsing: *.xml and *.trx, not macOS resource forks. */
export const isReportFile = (name: string) => /\.(xml|trx)$/i.test(name) && !/(^|\/)__MACOSX\//.test(name) && !/(^|\/)\._/.test(name);
