import { describe, it, expect } from "vitest";
import { parse, serialize, type BrowseState } from "./browseState";

// Module under test: src/lib/browseState.ts, the Releases hash keys (REL): tagTab, release, releaseForm, relPage.
// Requirements: REQ-1 "tab in address" (tagTab), REQ-7 "release detail address" (release), REQ-8 "draft form" (releaseForm), REQ-6 "pages of 10" (relPage).
// Rules fixed by these tests (from the BrowseState doc comments): release, releaseForm and relPage are honoured only with tagTab=releases;
// releaseForm=edit needs release; relPage is a positive integer; an absent tagTab means the Tags tab.
const roundTrip = (s: BrowseState) => parse(serialize(s));
const REPO = "#repo=acme%2Fweb";

describe("REQ-1: tagTab", () => {
  it("round-trips releases", () => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases" }), "Expected tagTab=releases to survive serialize and parse").toEqual({ repo: "acme/web", tagTab: "releases" });
  });

  it("parses tagTab=releases from an address", () => {
    expect(parse(`${REPO}&tagTab=releases`).tagTab, "Expected the Releases tab from the address").toBe("releases");
  });

  it("drops an unknown tagTab", () => {
    expect(parse(`${REPO}&tagTab=nope`).tagTab, "Expected an unknown tab to be dropped").toBeUndefined();
    expect(parse(`${REPO}&tagTab=`).tagTab, "Expected an empty tab to be dropped").toBeUndefined();
  });

  it("gives no tagTab when the address has none (absent means Tags)", () => {
    expect(parse(REPO), "Expected a plain repo address to carry no tagTab").toEqual({ repo: "acme/web" });
  });

  it("keeps the repo and search alongside", () => {
    expect(roundTrip({ repo: "acme/web", q: "v1", tagTab: "releases" }), "Expected repo, q and tagTab together").toEqual({ repo: "acme/web", q: "v1", tagTab: "releases" });
    expect(roundTrip({ repo: "acme/web", ref: "main", q: "v1", tagTab: "releases", relPage: 2 }), "Expected ref, q, tagTab and relPage together").toEqual({
      repo: "acme/web",
      ref: "main",
      q: "v1",
      tagTab: "releases",
      relPage: 2,
    });
  });
});

describe("REQ-7: release (the detail view's tag name)", () => {
  it.each(["v1.0", "release/v1 beta", "v1.0-β日本", "feat/ünï", "a&b=c#d", "100%"])("round-trips the tag %j with tagTab=releases", (release) => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", release }), `Expected release ${JSON.stringify(release)} to survive`).toEqual({ repo: "acme/web", tagTab: "releases", release });
  });

  it("parses an encoded tag name with a slash and a space", () => {
    expect(parse(`${REPO}&tagTab=releases&release=release%2Fv1%20beta`).release, "Expected 'release/v1 beta'").toBe("release/v1 beta");
  });

  it("is dropped when the address has no tagTab", () => {
    expect(parse(`${REPO}&release=v1.0`).release, "Expected release to be ignored without tagTab=releases").toBeUndefined();
  });

  it("is dropped when the tab is Tags", () => {
    expect(parse(`${REPO}&tagTab=tags&release=v1.0`).release, "Expected release to be ignored on the Tags tab").toBeUndefined();
  });

  it("is not written, so is not read back, without tagTab=releases", () => {
    expect(roundTrip({ repo: "acme/web", release: "v1.0" }).release, "Expected release not to survive without tagTab=releases").toBeUndefined();
  });
});

describe("REQ-8: releaseForm (the draft / edit form)", () => {
  it("round-trips new", () => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", releaseForm: "new" }), "Expected releaseForm=new to survive").toEqual({ repo: "acme/web", tagTab: "releases", releaseForm: "new" });
  });

  it("round-trips new with a tag to preselect", () => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", releaseForm: "new", release: "v1.1" }), "Expected the preselected tag to survive beside releaseForm=new").toEqual({
      repo: "acme/web",
      tagTab: "releases",
      releaseForm: "new",
      release: "v1.1",
    });
  });

  it("round-trips edit with the release being edited", () => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", releaseForm: "edit", release: "release/v1 beta" }), "Expected releaseForm=edit and its release to survive").toEqual({
      repo: "acme/web",
      tagTab: "releases",
      releaseForm: "edit",
      release: "release/v1 beta",
    });
  });

  it("drops edit when there is no release to edit", () => {
    expect(parse(`${REPO}&tagTab=releases&releaseForm=edit`).releaseForm, "Expected releaseForm=edit without release to be dropped").toBeUndefined();
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", releaseForm: "edit" }).releaseForm, "Expected serialize not to write an edit form with no release").toBeUndefined();
  });

  it("drops an unknown value", () => {
    expect(parse(`${REPO}&tagTab=releases&releaseForm=delete&release=v1.0`).releaseForm, "Expected an unknown form to be dropped").toBeUndefined();
    expect(parse(`${REPO}&tagTab=releases&releaseForm=`).releaseForm, "Expected an empty form to be dropped").toBeUndefined();
  });

  it("is dropped without tagTab=releases", () => {
    expect(parse(`${REPO}&releaseForm=new`).releaseForm, "Expected the form to be ignored with no tagTab").toBeUndefined();
    expect(parse(`${REPO}&tagTab=tags&releaseForm=new`).releaseForm, "Expected the form to be ignored on the Tags tab").toBeUndefined();
    expect(roundTrip({ repo: "acme/web", releaseForm: "new" }).releaseForm, "Expected the form not to survive without tagTab=releases").toBeUndefined();
  });
});

describe("REQ-6: relPage (the Releases list page)", () => {
  it.each([2, 3, 17])("round-trips page %d with tagTab=releases", (relPage) => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", relPage }), `Expected relPage ${relPage} to survive`).toEqual({ repo: "acme/web", tagTab: "releases", relPage });
  });

  it("parses relPage from an address", () => {
    expect(parse(`${REPO}&tagTab=releases&relPage=4`).relPage, "Expected page 4").toBe(4);
  });

  it.each(["0", "-1", "x", "1.5", ""])("drops %j as a page", (raw) => {
    expect(parse(`${REPO}&tagTab=releases&relPage=${encodeURIComponent(raw)}`).relPage, `Expected relPage=${JSON.stringify(raw)} to be dropped`).toBeUndefined();
  });

  it.each([0, -1])("does not write a page of %d", (relPage) => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", relPage }).relPage, `Expected relPage ${relPage} not to survive`).toBeUndefined();
  });

  it("is dropped without tagTab=releases", () => {
    expect(parse(`${REPO}&relPage=2`).relPage, "Expected relPage to be ignored with no tagTab").toBeUndefined();
    expect(parse(`${REPO}&tagTab=tags&relPage=2`).relPage, "Expected relPage to be ignored on the Tags tab").toBeUndefined();
    expect(roundTrip({ repo: "acme/web", relPage: 2 }).relPage, "Expected relPage not to survive without tagTab=releases").toBeUndefined();
  });
});

describe("relKind (Releases list chips)", () => {
  it.each(["published", "prerelease", "draft"] as const)("round-trips %s with tagTab=releases", (relKind) => {
    expect(roundTrip({ repo: "acme/web", tagTab: "releases", relKind })).toEqual({ repo: "acme/web", tagTab: "releases", relKind });
  });
  it("drops an unknown value and 'all' (absent means all)", () => {
    expect(parse("#repo=acme%2Fweb&tagTab=releases&relKind=all").relKind).toBeUndefined();
    expect(parse("#repo=acme%2Fweb&tagTab=releases&relKind=nope").relKind).toBeUndefined();
  });
  it("is dropped without tagTab=releases", () => {
    expect(parse("#repo=acme%2Fweb&relKind=draft").relKind).toBeUndefined();
    expect(serialize({ repo: "acme/web", relKind: "draft" })).not.toContain("relKind");
  });
});
