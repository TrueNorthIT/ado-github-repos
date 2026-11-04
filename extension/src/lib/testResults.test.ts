// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { groupsWith, isReportFile, parseTestReport, pickArtifacts, repeatedNames, summarise, TEST_SCAN_CAP, testDuration } from "./testResults";

const PYTEST = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="1" skipped="1" tests="5" time="1.234" timestamp="2026-11-01T10:00:00" hostname="runner">
<testcase classname="tests.test_math" name="test_add" time="0.001" />
<testcase classname="tests.test_math" name="test_div" time="0.002"><failure message="ZeroDivisionError: division by zero">def test_div():
&gt;       1 / 0
E       ZeroDivisionError: division by zero

tests/test_math.py:7: ZeroDivisionError</failure></testcase>
<testcase classname="tests.test_io" name="test_read" time="0.010"><error message="failed on setup with &quot;FileNotFoundError&quot;">trace</error></testcase>
<testcase classname="tests.test_io" name="test_write" time="0"><skipped type="pytest.skip" message="needs a disk">tests/test_io.py:12: needs a disk</skipped></testcase>
<testcase classname="tests.test_io" name="test_ok" time="0.5" />
</testsuite></testsuites>`;

const PYTEST_OLD = `<?xml version="1.0"?><testsuite name="pytest" tests="1" time="0.3"><testcase classname="t" name="a" time="0.3"/></testsuite>`;

const JEST = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="3" failures="1" errors="0" time="2.5">
  <testsuite name="queue" errors="0" failures="1" skipped="0" timestamp="2026-11-01T10:00:00" time="1.5" tests="2" file="src/queue.test.ts">
    <testcase classname="queue retries three times" name="queue retries three times" time="0.4">
      <failure>Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 2
    at Object.&lt;anonymous&gt; (/home/runner/work/app/src/queue.test.ts:42:17)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)</failure>
    </testcase>
    <testcase classname="queue drains" name="queue drains" time="1.1"/>
  </testsuite>
  <testsuite name="sync" tests="1" time="1.0"><testcase classname="sync works" name="sync works" time="1.0"/></testsuite>
</testsuites>`;

const SUREFIRE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://maven.apache.org/surefire/maven-surefire-plugin/xsd/surefire-test-report-3.0.xsd" version="3.0" name="com.acme.FooTest" time="0.051" tests="4" errors="1" skipped="1" failures="0">
  <properties><property name="java.version" value="21"/></properties>
  <testcase name="adds" classname="com.acme.FooTest" time="0.002"/>
  <testcase name="flaky" classname="com.acme.FooTest" time="0.01"><flakyFailure message="first try" type="java.lang.AssertionError"><stackTrace>at Foo</stackTrace></flakyFailure></testcase>
  <testcase name="explodes" classname="com.acme.FooTest" time="0.03"><error message="boom" type="java.lang.IllegalStateException">java.lang.IllegalStateException: boom
	at com.acme.FooTest.explodes(FooTest.java:20)</error><system-out>log</system-out></testcase>
  <testcase name="ignored" classname="com.acme.FooTest" time="0"><skipped/></testcase>
</testsuite>`;

const TRX = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="1" name="run" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Times creation="2026-11-01T10:00:00.000+00:00" start="2026-11-01T10:00:00.000+00:00" finish="2026-11-01T10:00:03.500+00:00" />
  <Results>
    <UnitTestResult testId="a" testName="Adds" duration="00:00:00.0123456" outcome="Passed" />
    <UnitTestResult testId="b" testName="Divides" duration="00:00:01.5" outcome="Failed"><Output><ErrorInfo><Message>Assert.Equal() Failure</Message><StackTrace>   at Calc.Tests.Divides() in Calc.cs:line 9</StackTrace></ErrorInfo></Output></UnitTestResult>
    <UnitTestResult testId="c" testName="Later" outcome="NotExecuted" />
  </Results>
  <TestDefinitions>
    <UnitTest id="a" name="Adds"><TestMethod className="Calc.Tests" name="Adds" /></UnitTest>
    <UnitTest id="b" name="Divides"><TestMethod className="Calc.Tests" name="Divides" /></UnitTest>
    <UnitTest id="c" name="Later"><TestMethod className="Calc.Other" name="Later" /></UnitTest>
  </TestDefinitions>
</TestRun>`;

describe("parseTestReport: JUnit", () => {
  it("reads pytest, splitting its one generic suite by module, with failures, errors and skips", () => {
    const r = parseTestReport(PYTEST, "junit/pytest.xml")!;
    expect(r.format).toBe("junit");
    expect(r.groups.map((g) => g.name)).toEqual(["tests.test_math", "tests.test_io"]);
    const [math, io] = r.groups;
    expect(math.source).toBe("junit/pytest.xml");
    expect(math.cases.map((c) => [c.name, c.outcome, c.durationMs])).toEqual([["test_add", "passed", 1], ["test_div", "failed", 2]]);
    expect(math.cases[1].message).toBe("ZeroDivisionError: division by zero");
    expect(math.cases[1].stackTrace).toContain("tests/test_math.py:7");
    expect(io.cases.map((c) => c.outcome)).toEqual(["failed", "other", "passed"]);
    expect(io.cases[0].message).toBe('failed on setup with "FileNotFoundError"');
    expect(io.cases[1]).toMatchObject({ otherKind: "Skipped", message: "needs a disk" });
    expect(r.durationMs).toBe(1234);
  });

  it("reads a bare <testsuite> root (older pytest)", () => {
    const r = parseTestReport(PYTEST_OLD, "a.xml")!;
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].cases[0]).toMatchObject({ name: "a", className: "t", outcome: "passed", durationMs: 300 });
    expect(r.durationMs).toBe(300);
  });

  it("reads jest-junit: groups by file, and splits a message-less failure into message and stack", () => {
    const r = parseTestReport(JEST, "jest/junit.xml")!;
    expect(r.groups.map((g) => g.name)).toEqual(["src/queue.test.ts", "sync"]);
    const f = r.groups[0].cases[0];
    expect(f.outcome).toBe("failed");
    expect(f.message).toBe("Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 3\nReceived: 2");
    expect(f.stackTrace).toContain("queue.test.ts:42:17");
    expect(f.stackTrace).not.toContain("Received: 2");
    expect(r.durationMs).toBe(2500);
  });

  it("reads surefire: <error> fails, <flakyFailure> passed in the end, <skipped/> is other", () => {
    const r = parseTestReport(SUREFIRE, "surefire/TEST-com.acme.FooTest.xml")!;
    expect(r.groups[0].name).toBe("com.acme.FooTest");
    expect(r.groups[0].cases.map((c) => [c.name, c.outcome])).toEqual([["adds", "passed"], ["flaky", "passed"], ["explodes", "failed"], ["ignored", "other"]]);
    expect(r.groups[0].cases[2]).toMatchObject({ message: "boom" });
    expect(r.groups[0].cases[2].stackTrace).toContain("FooTest.java:20");
    expect(r.durationMs).toBe(51);
  });

  it("reads Node's built-in junit reporter: testcases straight under <testsuites> (as the sandbox's test/failing run uploads)", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="add" time="0.000904" classname="test"/>
	<testcase name="retry succeeds on the third attempt" time="0.001166" classname="test" failure="not yet">
		<failure type="testCodeFailure" message="not yet">
[Error [ERR_TEST_FAILURE]: not yet] {
  cause: Error: not yet
      at file:///home/runner/work/gh-repos-sandbox/gh-repos-sandbox/test/math.test.js:9:48
}
		</failure>
	</testcase>
	<!-- tests 2 -->
	<!-- duration_ms 57.740533 -->
</testsuites>`;
    const r = parseTestReport(xml, "test-results-node-20/junit.xml")!;
    expect(r.groups.map((g) => [g.name, g.cases.map((c) => c.outcome)])).toEqual([["test", ["passed", "failed"]]]);
    expect(r.groups[0].cases[1].message).toBe("not yet");
    expect(r.groups[0].cases[1].stackTrace).toContain("math.test.js:9:48");
    expect(summarise([r]).durationMs).toBe(2); // 0.904 ms + 1.166 ms, from the tests' times
  });

  it("assigns cases of nested suites to their nearest suite", () => {
    const r = parseTestReport(`<testsuites><testsuite name="outer"><testcase name="o"/><testsuite name="inner"><testcase name="i"/></testsuite></testsuite></testsuites>`, "n.xml")!;
    expect(r.groups.map((g) => [g.name, g.cases.map((c) => c.name)])).toEqual([["outer", ["o"]], ["inner", ["i"]]]);
  });

  it("accepts an empty suite and odd times", () => {
    const r = parseTestReport(`<testsuite name="none" tests="0" time="1,234.5"/>`, "e.xml")!;
    expect(r.groups).toEqual([]);
    expect(r.durationMs).toBe(1234500);
    const bad = parseTestReport(`<testsuite name="x"><testcase name="a" time="NaN"/><testcase name="b" time="-1"/></testsuite>`, "t.xml")!;
    expect(bad.groups[0].cases.map((c) => c.durationMs)).toEqual([undefined, undefined]);
  });

  it("treats status=skipped as other", () => {
    const r = parseTestReport(`<testsuite name="s"><testcase name="a" status="notrun"/></testsuite>`, "s.xml")!;
    expect(r.groups[0].cases[0].outcome).toBe("other");
  });
});

describe("parseTestReport: TRX", () => {
  it("reads outcomes, durations, error info, and groups by class", () => {
    const r = parseTestReport(TRX, "trx/run.trx")!;
    expect(r.format).toBe("trx");
    expect(r.groups.map((g) => g.name)).toEqual(["Calc.Tests", "Calc.Other"]);
    expect(r.groups[0].cases.map((c) => [c.name, c.outcome, c.durationMs])).toEqual([["Adds", "passed", 12], ["Divides", "failed", 1500]]);
    expect(r.groups[0].cases[1]).toMatchObject({ message: "Assert.Equal() Failure", stackTrace: "at Calc.Tests.Divides() in Calc.cs:line 9" });
    expect(r.groups[1].cases[0]).toMatchObject({ outcome: "other", otherKind: "Not executed" });
    expect(r.durationMs).toBe(3500);
  });
});

describe("parseTestReport: not a report", () => {
  it.each([
    ["coverage", `<?xml version="1.0"?><coverage line-rate="0.9"><packages/></coverage>`],
    ["pom", `<project><modelVersion>4.0.0</modelVersion></project>`],
    ["malformed", `<testsuites><testsuite name="x"><testcase name="a"></testsuites>`],
    ["empty", ``],
    ["html", `<html><body>testsuite</body></html>`],
  ])("returns null for %s", (_n, xml) => {
    expect(parseTestReport(xml, "x.xml")).toBeNull();
  });
});

describe("summarise and groupsWith", () => {
  const reports = [parseTestReport(PYTEST, "p.xml")!, parseTestReport(JEST, "j.xml")!, parseTestReport(TRX, "t.trx")!];

  it("totals outcomes; the pass percentage leaves others out, as native does", () => {
    const s = summarise(reports);
    expect(s).toMatchObject({ total: 11, passed: 5, failed: 4, others: 2 });
    expect(s.passPercent).toBe(55.5); // 5 of 9, rounded down
    expect(s.durationMs).toBe(1234 + 2500 + 3500);
  });

  it("falls back to the sum of the tests' times, and has no percentage with nothing run", () => {
    const r = parseTestReport(`<testsuites><testsuite name="a"><testcase name="x" time="0.25"/><testcase name="y" time="0.5"/></testsuite></testsuites>`, "a.xml")!;
    expect(summarise([r]).durationMs).toBe(750);
    expect(summarise([]).passPercent).toBeUndefined();
    expect(summarise([]).durationMs).toBeUndefined();
  });

  it("lists failed groups first, failed tests first in each, and leaves out empty groups", () => {
    const failed = groupsWith(reports, ["failed"]);
    expect(failed.map((g) => g.name)).toEqual(["Calc.Tests", "src/queue.test.ts", "tests.test_io", "tests.test_math"]);
    expect(failed.every((g) => g.cases.every((c) => c.outcome === "failed"))).toBe(true);
    const all = groupsWith(reports, ["failed", "passed", "other"]);
    expect(all[all.length - 1].cases.some((c) => c.outcome === "failed")).toBe(false);
    expect(all.find((g) => g.name === "tests.test_io")!.cases.map((c) => c.outcome)).toEqual(["failed", "other", "passed"]);
  });
});

describe("testDuration and repeatedNames", () => {
  it.each([[undefined, ""], [-1, ""], [0, "0:00:00.000"], [12, "0:00:00.012"], [1503, "0:00:01.503"], [61_000, "0:01:01.000"], [3_723_004, "1:02:03.004"], [1.6, "0:00:00.002"]])("%s ms -> %s", (ms, out) => {
    expect(testDuration(ms)).toBe(out);
  });

  it("names the groups that occur twice", () => {
    const g = (name: string) => ({ name, source: "s", cases: [] });
    expect([...repeatedNames([g("a"), g("b"), g("a"), g("a")])]).toEqual(["a"]);
  });
});

describe("pickArtifacts", () => {
  const a = (id: number, name: string, mb: number, expired = false) => ({ id, name, sizeInBytes: mb * 1024 * 1024, expired });

  it("takes likely names first, then the smallest, up to the cap", () => {
    const { read, skipped } = pickArtifacts([a(1, "build-output", 15), a(2, "junit-results", 8), a(3, "logs", 1), a(4, "old", 1, true), a(5, "coverage", 30)]);
    expect(read.map((x) => x.id)).toEqual([2, 3]);
    expect(skipped.map((s) => [s.artifact.id, s.reason])).toEqual([[4, "expired"], [1, "tooLarge"], [5, "tooLarge"]]);
    expect(TEST_SCAN_CAP).toBe(20 * 1024 * 1024);
  });

  it("can fill the cap exactly", () => {
    expect(pickArtifacts([a(1, "x", 10), a(2, "y", 10)]).read).toHaveLength(2);
  });
});

describe("isReportFile", () => {
  it.each([["junit.xml", true], ["out/TEST-Foo.XML", true], ["r.trx", true], ["__MACOSX/._junit.xml", false], ["dir/._junit.xml", false], ["report.json", false], ["xml", false]])("%s -> %s", (n, ok) => {
    expect(isReportFile(n)).toBe(ok);
  });
});
