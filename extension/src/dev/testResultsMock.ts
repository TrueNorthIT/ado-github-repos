// __TN_MOCK__ Artifact zips for the mock run page: run 9001's "test-results" holds JUnit XML from both matrix legs (jest-junit style)
// and a pytest report; "coverage-report" holds a Cobertura file (XML that is not a test report); the rest hold a text file. Built at
// request time with lib/zipWrite, the JUnit entries deflated so the Tests tab exercises DecompressionStream.
import { buildZip, deflateRaw } from "../lib/zipWrite";

const enc = new TextEncoder();

const jest = (node: string, fail: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="9" failures="${fail ? 2 : 0}" errors="0" time="${fail ? "6.412" : "5.981"}">
  <testsuite name="queue" errors="0" failures="${fail ? 2 : 0}" skipped="1" timestamp="2026-11-01T10:00:08" time="3.204" tests="5" file="src/lib/queue.test.ts">
    <testcase classname="queue enqueues in order" name="queue enqueues in order" time="0.012"/>
    ${fail ? `<testcase classname="queue retries three times before giving up" name="queue retries three times before giving up" time="1.503">
      <failure>Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 2
    at Object.&lt;anonymous&gt; (/home/runner/work/github-repos/github-repos/src/lib/queue.test.ts:42:21)
    at Promise.then.completed (/home/runner/work/github-repos/github-repos/node_modules/jest-circus/build/utils.js:298:28)
    at new Promise (&lt;anonymous&gt;)
    at callAsyncCircusFn (/home/runner/work/github-repos/github-repos/node_modules/jest-circus/build/utils.js:231:10)</failure>
    </testcase>
    <testcase classname="queue backs off between retries" name="queue backs off between retries" time="1.112">
      <failure>Error: Timed out after 1000 ms waiting for the second attempt
    at waitFor (/home/runner/work/github-repos/github-repos/src/test/waitFor.ts:18:11)
    at Object.&lt;anonymous&gt; (/home/runner/work/github-repos/github-repos/src/lib/queue.test.ts:61:5)</failure>
    </testcase>` : `<testcase classname="queue retries three times before giving up" name="queue retries three times before giving up" time="1.420"/>
    <testcase classname="queue backs off between retries" name="queue backs off between retries" time="1.090"/>`}
    <testcase classname="queue drains on shutdown" name="queue drains on shutdown" time="0.577"/>
    <testcase classname="queue persists across reloads" name="queue persists across reloads" time="0"><skipped/></testcase>
  </testsuite>
  <testsuite name="sync" errors="0" failures="0" skipped="0" time="2.1" tests="4" file="src/lib/sync.test.ts">
    <testcase classname="sync merges remote changes" name="sync merges remote changes" time="0.801"/>
    <testcase classname="sync keeps local edits" name="sync keeps local edits" time="0.644"/>
    <testcase classname="sync retries on 502" name="sync retries on 502" time="0.402"/>
    <testcase classname="sync gives up after the budget" name="sync gives up after the budget" time="0.253"/>
  </testsuite>
</testsuites>
<!-- ${node} -->`;

const PYTEST = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="3" time="0.412" timestamp="2026-11-01T10:00:20" hostname="runner">
<testcase classname="scripts.test_release_notes" name="test_groups_by_commit" time="0.104"/>
<testcase classname="scripts.test_release_notes" name="test_skips_merges" time="0.098"/>
<testcase classname="scripts.test_version" name="test_versions_match" time="0.210"/>
</testsuite></testsuites>`;

const COBERTURA = `<?xml version="1.0" ?><coverage line-rate="0.87" branch-rate="0.71" version="1.9" timestamp="1762000000"><packages/></coverage>`;

export async function artifactZip(id: number): Promise<Uint8Array> {
  const xml = async (name: string, text: string) => {
    const data = enc.encode(text);
    return { name, data, deflated: await deflateRaw(data) };
  };
  if (id === 7005) {
    return buildZip([
      await xml("node-18/junit.xml", jest("node 18", false)),
      await xml("node-20/junit.xml", jest("node 20", true)),
      await xml("scripts/pytest.xml", PYTEST),
      { name: "README.txt", data: enc.encode("JUnit reports from the test job.\n") },
    ]);
  }
  if (id === 7001) return buildZip([await xml("coverage/cobertura-coverage.xml", COBERTURA), { name: "coverage/index.html", data: enc.encode("<!doctype html><title>Coverage</title>") }]);
  return buildZip([{ name: "README.txt", data: enc.encode(`Mock artifact ${id}.\n`) }]);
}
