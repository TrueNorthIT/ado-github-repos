import { describe, it, expect } from "vitest";
import { parseNewPr, serializeNewPr, applyNewPr, branchRowNewPrHash, prListNewPrHash, existingPrHash } from "./newPrHash";
import { parse, serialize } from "./browseState";
import { NASTY } from "./ciTestHelpers";

// Module under test: src/lib/newPrHash.ts (stubs until the developer implements them). Requirement CP-6: "Add view=newpr&source=...&target=.... Write a new parse/serialise module that sits alongside
// browseState without editing it, and round-trip through browseState.parse/serialize like prListFilters does. Give URL builders for the Branches row action and the PR list 'New pull request' button."
// CP-1 adds "View the existing pull request", which needs a link to the pull request page. Decisions (browseState drops view=newpr, so the app reads parseNewPr first) are in the header of src/lib/newPrHash.ts.

const REPO = "octo/demo";
const ENC = "repo=octo%2Fdemo";

describe("CP-6: serializeNewPr", () => {
  it("writes repo, view=newpr, source and target in that order, encoded", () => {
    expect(serializeNewPr({ repo: REPO, source: "feature/x", target: "main" }), "Expected #repo, view=newpr, source and target").toBe(`#${ENC}&view=newpr&source=feature%2Fx&target=main`);
  });

  it("leaves out a source or target that is missing or blank", () => {
    expect(serializeNewPr({ repo: REPO }), "Expected only repo and view").toBe(`#${ENC}&view=newpr`);
    expect(serializeNewPr({ repo: REPO, source: "  ", target: "" }), "Expected blank values to be left out").toBe(`#${ENC}&view=newpr`);
    expect(serializeNewPr({ repo: REPO, target: "main" }), "Expected the target alone").toBe(`#${ENC}&view=newpr&target=main`);
  });

  it("caps source and target at 255 characters", () => {
    const hash = serializeNewPr({ repo: REPO, source: "a".repeat(400), target: "b".repeat(400) });
    expect(parseNewPr(hash), "Expected both values cut to 255 characters").toEqual({ repo: REPO, source: "a".repeat(255), target: "b".repeat(255) });
  });
});

describe("CP-6: parseNewPr", () => {
  it("reads repo, source and target from a New pull request hash", () => {
    expect(parseNewPr(`#${ENC}&view=newpr&source=feature%2Fx&target=main`), "Expected the three values").toEqual({ repo: REPO, source: "feature/x", target: "main" });
  });

  it("accepts a hash without '#' or with several (ADO's breadcrumb prefixes its own)", () => {
    expect(parseNewPr(`${ENC}&view=newpr&source=a`), "Expected no leading # to be fine").toEqual({ repo: REPO, source: "a" });
    expect(parseNewPr(`##${ENC}&view=newpr&source=a`), "Expected '##' to be fine").toEqual({ repo: REPO, source: "a" });
  });

  it("is null unless the view is newpr", () => {
    expect(parseNewPr(`#${ENC}&source=a&target=b`), "Expected null without a view").toBeNull();
    expect(parseNewPr(`#${ENC}&view=prs&source=a`), "Expected null for another view").toBeNull();
    expect(parseNewPr(""), "Expected null for an empty hash").toBeNull();
  });

  it("is null without a valid repository", () => {
    expect(parseNewPr("#view=newpr&source=a"), "Expected null without a repo").toBeNull();
    expect(parseNewPr("#repo=../x&view=newpr"), "Expected null for an invalid repo").toBeNull();
    expect(parseNewPr("#repo=nonsense&view=newpr"), "Expected null for a repo without an owner").toBeNull();
  });

  it("drops a blank source or target", () => {
    expect(parseNewPr(`#${ENC}&view=newpr&source=&target=%20`), "Expected blank values to be dropped").toEqual({ repo: REPO });
  });

  it("never throws", () => {
    for (const bad of ["#%E0%A4%A", `#${ENC}&view=newpr&source=%E0%A4%A`, "#&&&", "=", "#repo=%"]) expect(() => parseNewPr(bad), `Expected ${bad} not to throw`).not.toThrow();
  });
});

describe("CP-6: round trips", () => {
  it("parseNewPr reads back what serializeNewPr wrote, awkward values included", () => {
    for (const v of NASTY) {
      const s = { repo: REPO, source: v, target: v };
      expect(parseNewPr(serializeNewPr(s)), `Expected ${JSON.stringify(v)} to survive the hash`).toEqual(s);
    }
  });

  it("applyNewPr keeps other segments in order, drops earlier view, source and target, and puts its own keys last", () => {
    expect(applyNewPr(`#${ENC}&view=prs&prTab=active&source=old&target=old`, { source: "a", target: "b" }), "Expected prTab kept, old keys replaced").toBe(`#${ENC}&prTab=active&view=newpr&source=a&target=b`);
    expect(applyNewPr("view=prs", { source: "a" }), "Expected a leading #").toBe("#view=newpr&source=a");
    expect(applyNewPr(`#${ENC}&source=old`, {}), "Expected an absent source to remove the old one").toBe(`#${ENC}&view=newpr`);
  });

  it("browseState keeps the repository of a New pull request hash but not its view", () => {
    const hash = serializeNewPr({ repo: REPO, source: "feature/x", target: "main" });
    expect(parse(hash), "Expected browseState to read the repo and ignore the New pull request keys (no key collision)").toEqual({ repo: REPO });
  });

  it("applyNewPr puts the keys back on a hash that browseState rewrote", () => {
    const original = serializeNewPr({ repo: REPO, source: "feature/x", target: "main" });
    const rewritten = serialize(parse(original));
    expect(applyNewPr(rewritten, { source: "feature/x", target: "main" }), "Expected the original hash back").toBe(original);
  });

  it("turns a pull request list hash into a New pull request hash that both modules can read", () => {
    const hash = applyNewPr(serialize({ repo: REPO, view: "prs", prTab: "active" }), { source: "feature/x" });
    expect(parse(hash), "Expected browseState to read the repo").toEqual({ repo: REPO });
    expect(parseNewPr(hash), "Expected parseNewPr to read the source").toEqual({ repo: REPO, source: "feature/x" });
  });
});

describe("CP-6 / CP-1: entry points", () => {
  it("the Branches row action opens the page with that branch as the source and no target", () => {
    const hash = branchRowNewPrHash(REPO, "feature/x");
    expect(hash, "Expected repo, view=newpr and the source only").toBe(`#${ENC}&view=newpr&source=feature%2Fx`);
    expect(parseNewPr(hash), "Expected the page to read the source back").toEqual({ repo: REPO, source: "feature/x" });
  });

  it("the Branches row action copes with awkward branch names", () => {
    for (const v of NASTY) expect(parseNewPr(branchRowNewPrHash(REPO, v)), `Expected ${JSON.stringify(v)} to survive`).toEqual({ repo: REPO, source: v });
  });

  it("the PR list's New pull request button carries only the repository", () => {
    const hash = prListNewPrHash(REPO);
    expect(hash, "Expected repo and view=newpr").toBe(`#${ENC}&view=newpr`);
    expect(parseNewPr(hash), "Expected no source or target").toEqual({ repo: REPO });
  });

  it("'View the existing pull request' links to the pull request page browseState understands", () => {
    const hash = existingPrHash(REPO, 12);
    expect(hash, "Expected the hash browseState.serialize gives for the pull request").toBe(serialize({ repo: REPO, view: "prs", pr: 12 }));
    expect(parse(hash), "Expected browseState to read the pull request").toEqual({ repo: REPO, view: "prs", pr: 12 });
  });
});
