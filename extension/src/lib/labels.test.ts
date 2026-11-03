import { describe, it, expect } from "vitest";
import { labelSearchQuery, labelTextColor, toLabelOption, availableLabels, addLabelsMutation, removeLabelsMutation, type LabelOption } from "./labels";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectConnectionCall, expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/labels.ts (stubs until the developer implements them). Schema facts are in its header.
// Requirement ED-3 "Labels (ADO 'Tags'). Add with addLabelsToLabelable and remove with removeLabelsFromLabelable. Search the repo's labels(query:). Map to a display shape with name, colour (hex to a text
// colour with readable contrast: a pure function, tested for light and dark) and description."
// Decisions fixed by these tests:
//  - the text colour is black or white, whichever has the higher WCAG contrast ratio against the label colour.
//  - labelSearchQuery sends owner, name and the trimmed query (null when blank) as variables.

// WCAG 2.x contrast, written out here as the oracle so the tests check readability itself, not the implementation's arithmetic.
const channel = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("ED-3: labelTextColor", () => {
  // Light backgrounds need dark text.
  it.each(["ffffff", "fbca04", "c5def5", "e4e669", "d4c5f9", "bfdadc", "7fe5a0"])("gives black text on the light colour %s", (hex) => {
    expect(labelTextColor(hex), `Expected black text on #${hex}`).toBe("#000000");
  });

  // Dark backgrounds need light text.
  it.each(["000000", "0052cc", "5319e7", "1d3557", "b60205", "333333"])("gives white text on the dark colour %s", (hex) => {
    expect(labelTextColor(hex), `Expected white text on #${hex}`).toBe("#ffffff");
  });

  it("always picks the better contrast, across the whole colour cube", () => {
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
          const picked = labelTextColor(hex);
          const other = picked === "#000000" ? "#ffffff" : "#000000";
          expect(contrast(hex, picked), `Expected ${picked} to read at least as well as ${other} on #${hex}`).toBeGreaterThanOrEqual(contrast(hex, other));
        }
  });

  it("gives readable text (contrast at least 4.4) on typical GitHub label colours", () => {
    for (const hex of ["d73a4a", "0075ca", "cfd3d7", "a2eeef", "7057ff", "008672", "e99695", "fef2c0", "d876e3"]) {
      const picked = labelTextColor(hex);
      expect(contrast(hex, picked), `Expected readable contrast for ${picked} on #${hex}`).toBeGreaterThanOrEqual(4.4);
    }
  });

  it("accepts a leading #, upper case and the 3-digit form", () => {
    expect(labelTextColor("#FFFFFF"), "Expected #FFFFFF to be read as white").toBe("#000000");
    expect(labelTextColor("#000"), "Expected #000 to be read as black").toBe("#ffffff");
    expect(labelTextColor("FA0"), "Expected the 3-digit FA0 (ffaa00) to be read as light").toBe("#000000");
    expect(labelTextColor("D73A4A"), "Expected upper case to give the same answer as lower case").toBe(labelTextColor("d73a4a"));
  });

  it("does not throw on anything that is not a hex colour, and still returns black or white", () => {
    for (const bad of ["", "zzzzzz", "12345", "#12", "not a colour"]) {
      const out = labelTextColor(bad);
      expect(["#000000", "#ffffff"], `Expected black or white for ${JSON.stringify(bad)}`).toContain(out);
    }
  });
});

describe("ED-3: toLabelOption", () => {
  it("copies id, name, colour and description and adds the text colour", () => {
    expect(toLabelOption({ id: "L1", name: "bug", color: "d73a4a", description: "Something isn't working" }), "Expected the display shape").toEqual({
      id: "L1",
      name: "bug",
      color: "d73a4a",
      textColor: labelTextColor("d73a4a"),
      description: "Something isn't working",
    });
  });

  it("gives an empty description for null or missing", () => {
    expect(toLabelOption({ id: "L1", name: "x", color: "ffffff", description: null }).description, "Expected '' for null").toBe("");
    expect(toLabelOption({ id: "L1", name: "x", color: "ffffff" }).description, "Expected '' for missing").toBe("");
  });

  it("uses black text on a light label and white on a dark one", () => {
    expect(toLabelOption({ id: "L1", name: "light", color: "ffffff" }).textColor, "Expected black on white").toBe("#000000");
    expect(toLabelOption({ id: "L2", name: "dark", color: "000000" }).textColor, "Expected white on black").toBe("#ffffff");
  });
});

describe("ED-3: availableLabels", () => {
  const opt = (id: string): LabelOption => toLabelOption({ id, name: `name-${id}`, color: "ffffff" });

  it("leaves out labels already on the pull request, keeping the order", () => {
    expect(availableLabels([opt("1"), opt("2"), opt("3")], ["2"]).map((o) => o.id), "Expected 1 and 3").toEqual(["1", "3"]);
  });

  it("returns everything when nothing is applied", () => {
    expect(availableLabels([opt("1"), opt("2")], []).map((o) => o.id), "Expected both").toEqual(["1", "2"]);
  });
});

describe("ED-3: labelSearchQuery", () => {
  it("is a variables-only query on repository.labels", () => {
    const req = labelSearchQuery({ owner: "octo", name: "repo", query: "bug" });
    expectQueryOperation(req);
    expect(req.query, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expectConnectionCall(req, "labels", ["query:$query", "first:20"]);
    expect(req.variables, "Expected variables { owner, name, query }").toEqual({ owner: "octo", name: "repo", query: "bug" });
  });

  it("selects id, name, color and description", () => {
    expectSelection(labelSearchQuery({ owner: "o", name: "r", query: "" }), /labels\([^)]*\)\s*\{\s*nodes/, ["id", "name", "color", "description"], "the label fields");
  });

  it("trims the query and sends null when blank", () => {
    expect(labelSearchQuery({ owner: "o", name: "r", query: " bug " }).variables, "Expected a trimmed query").toMatchObject({ query: "bug" });
    expect(labelSearchQuery({ owner: "o", name: "r", query: "" }).variables, "Expected null for a blank query").toMatchObject({ query: null });
  });

  it("keeps awkward text out of the query string", () => {
    const req = labelSearchQuery({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] });
    expectNotInQuery(req, [NASTY[0], NASTY[1], NASTY[2]]);
    expect(req.variables, "Expected the values verbatim in variables").toEqual({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] });
  });
});

describe("ED-3: add and remove label mutations", () => {
  it("addLabelsMutation is a mutation taking $input: AddLabelsToLabelableInput!", () => {
    const req = addLabelsMutation("PR1", ["L1", "L2"]);
    expectMutation(req, "AddLabelsToLabelableInput", "addLabelsToLabelable");
    expect(req.variables, "Expected { labelableId, labelIds }").toEqual({ input: { labelableId: "PR1", labelIds: ["L1", "L2"] } });
  });

  it("removeLabelsMutation is a mutation taking $input: RemoveLabelsFromLabelableInput!", () => {
    const req = removeLabelsMutation("PR1", ["L1"]);
    expectMutation(req, "RemoveLabelsFromLabelableInput", "removeLabelsFromLabelable");
    expect(req.variables, "Expected { labelableId, labelIds }").toEqual({ input: { labelableId: "PR1", labelIds: ["L1"] } });
  });

  it("both select the pull request's labels back with ids", () => {
    for (const req of [addLabelsMutation("PR1", ["L1"]), removeLabelsMutation("PR1", ["L1"])]) {
      expectSelection(req, /labelable\s*\{\s*\.\.\. on PullRequest/, ["id", "labels"], "the pull request payload");
      expectSelection(req, /labels\([^)]*\)\s*\{\s*nodes/, ["id", "name", "color", "description"], "the returned labels");
    }
  });

  it("keep ids out of the query text", () => {
    expectNotInQuery(addLabelsMutation(NASTY[0], [NASTY[1]]), [NASTY[0], NASTY[1]]);
    expectNotInQuery(removeLabelsMutation(NASTY[0], [NASTY[1]]), [NASTY[0], NASTY[1]]);
  });

  it("refuse a blank labelable id", () => {
    expect(() => addLabelsMutation("  ", ["L1"]), "Expected a blank id to be refused (add)").toThrow(/labelableId is required/);
    expect(() => removeLabelsMutation("", ["L1"]), "Expected a blank id to be refused (remove)").toThrow(/labelableId is required/);
  });

  it("refuse an empty label list", () => {
    expect(() => addLabelsMutation("PR1", []), "Expected no labels to be refused (add)").toThrow(/at least one label is required/);
    expect(() => removeLabelsMutation("PR1", []), "Expected no labels to be refused (remove)").toThrow(/at least one label is required/);
  });
});
