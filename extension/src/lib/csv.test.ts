import { describe, it, expect } from "vitest";
import { parseTable, tableDelimiter, diffTables, changedColumns, columnCount, columnWidth, diffColumnWidth, similarity, widthFor, MAX_LCS_CELLS, PAIR_WINDOW, TABLE_DIFF_VIEWS } from "./csv";

describe("tableDelimiter", () => {
  it.each([
    ["data/a.csv", ","],
    ["A.CSV", ","],
    ["x/y.tsv", "\t"],
    ["notes.md", null],
    ["csv", null],
    [".csv.bak", null],
  ])("%s -> %j", (p, d) => expect(tableDelimiter(p)).toBe(d));
  it("opens a table diff on the source", () => expect(TABLE_DIFF_VIEWS).toEqual({ views: ["source", "rendered"], default: "source" }));
});

describe("parseTable (RFC 4180)", () => {
  const rows = (t: string, d = ",") => parseTable(t, d).rows;

  it("splits simple records", () => expect(rows("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]));
  it("accepts CRLF, LF and lone CR line ends", () => expect(rows("a,b\r\n1,2\r3,4\n5,6")).toEqual([["a", "b"], ["1", "2"], ["3", "4"], ["5", "6"]]));
  it("does not add a record for the final line break", () => expect(rows("a\n").length).toBe(1));
  it("has no records for empty text", () => expect(parseTable("")).toEqual({ rows: [], total: 0, truncated: false }));
  it("skips blank lines", () => expect(rows("a,b\n\n1,2\n\r\n")).toEqual([["a", "b"], ["1", "2"]]));
  it("keeps empty fields, leading and trailing", () => expect(rows(",a,\n,,")).toEqual([["", "a", ""], ["", "", ""]]));
  it("keeps spaces around fields", () => expect(rows(" a , b ")).toEqual([[" a ", " b "]]));
  it("reads a quoted field with commas", () => expect(rows('name,desc\nx,"one, two, three"')).toEqual([["name", "desc"], ["x", "one, two, three"]]));
  it("reads a quoted field with line breaks", () => expect(rows('a,"line 1\r\nline 2\nline 3",b\nc,d,e')).toEqual([["a", "line 1\r\nline 2\nline 3", "b"], ["c", "d", "e"]]));
  it("unescapes doubled quotes", () => expect(rows('"say ""hi""",""""')).toEqual([['say "hi"', '"']]));
  it("reads an empty quoted field", () => expect(rows('"",x,""')).toEqual([["", "x", ""]]));
  it("keeps a quote in the middle of an unquoted field", () => expect(rows('5" disk,ok')).toEqual([['5" disk', "ok"]]));
  it("keeps text after a closing quote", () => expect(rows('"a"b,c')).toEqual([["ab", "c"]]));
  it("runs an unterminated quote to the end", () => expect(rows('a,"open\nstill')).toEqual([["a", "open\nstill"]]));
  it("drops a byte-order mark", () => expect(rows("﻿id,name\n1,x")[0]).toEqual(["id", "name"]));
  it("keeps ragged rows as they are", () => expect(rows("a,b,c\n1\n1,2,3,4")).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"]]));
  it("splits TSV on tabs, leaving commas alone", () => expect(rows("a\tb,c\n1\t\"x\ty\"", "\t")).toEqual([["a", "b,c"], ["1", "x\ty"]]));
  it("ends a quoted field at end of input", () => expect(rows('a,"b"')).toEqual([["a", "b"]]));

  it("caps the rows kept but counts them all", () => {
    const text = Array.from({ length: 10 }, (_, i) => `${i},v${i}`).join("\n");
    const t = parseTable(text, ",", 4);
    expect(t.rows.length).toBe(4);
    expect(t.total).toBe(10);
    expect(t.truncated).toBe(true);
    expect(parseTable(text, ",", 10).truncated).toBe(false);
  });

  it("parses a large file quickly", () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `${i},"name ${i}, with comma",${i * 2}`).join("\r\n");
    const t0 = Date.now();
    const t = parseTable(text, ",", 5000);
    expect(t.total).toBe(50_000);
    expect(t.rows[4999]).toEqual(["4999", "name 4999, with comma", "9998"]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("diffTables", () => {
  const T = (s: string) => parseTable(s).rows;
  const kinds = (d: ReturnType<typeof diffTables>) => d.map((r) => r.kind[0]).join("");

  it("marks identical tables as all same", () => {
    const d = diffTables(T("a,b\n1,2"), T("a,b\n1,2"));
    expect(kinds(d)).toBe("ss");
  });

  it("finds an added row in the middle", () => {
    const d = diffTables(T("h\n1\n2\n3"), T("h\n1\nnew\n2\n3"));
    expect(kinds(d)).toBe("ssass");
    expect(d[2]).toEqual({ kind: "added", cells: ["new"], newIndex: 2 });
  });

  it("finds a removed row", () => {
    const d = diffTables(T("h\n1\n2\n3"), T("h\n1\n3"));
    expect(kinds(d)).toBe("ssrs");
    expect(d[2]).toEqual({ kind: "removed", cells: ["2"], oldIndex: 2 });
  });

  it("pairs an edited row by position and lists its changed cells", () => {
    const d = diffTables(T("id,name,qty\n1,apple,3\n2,pear,5"), T("id,name,qty\n1,apple,4\n2,pear,5"));
    expect(kinds(d)).toBe("scs");
    expect(d[1]).toEqual({ kind: "changed", cells: ["1", "apple", "4"], oldCells: ["1", "apple", "3"], changed: [2], oldIndex: 1, newIndex: 1 });
  });

  it("pairs an edited record with its new self, not with the row at its position", () => {
    const d = diffTables(
      T("sku,name,price,stock\nA-300,Gizmo,19.99,40\nA-400,\"Bolt, M6\",0.10,5000"),
      T("sku,name,price,stock\nA-400,\"Bolt, M6\",0.10,4200\nA-450,\"Nut, M6\",0.08,3000")
    );
    expect(kinds(d)).toBe("srca");
    expect(d[2]).toMatchObject({ kind: "changed", changed: [3], oldIndex: 2, newIndex: 1 });
  });

  it("keeps rows with less than half their cells in common as removed and added", () => {
    expect(kinds(diffTables(T("h\na\nb\nz"), T("h\nA\nB\nC\nz")))).toBe("srraaas");
    expect(kinds(diffTables(T("a,b,c,d\n1,2,3,4"), T("a,b,c,d\n1,9,9,9")))).toBe("sra");
    expect(kinds(diffTables(T("a,b,c,d\n1,2,3,4"), T("a,b,c,d\n1,2,9,9")))).toBe("sc");
  });

  it("emits added rows that come before an edit's partner in order", () => {
    const d = diffTables(T("h,v\nk1,1"), T("h,v\nnew,0\nk1,2"));
    expect(kinds(d)).toBe("sac");
  });

  it("looks only PAIR_WINDOW rows ahead for a partner", () => {
    const before = [["k", "old"]];
    const after = [...Array.from({ length: PAIR_WINDOW }, (_, i) => [`x${i}`, `y${i}`]), ["k", "new"]];
    const d = diffTables(before, after);
    expect(d.filter((r) => r.kind === "changed").length).toBe(0);
  });

  it("handles an added and a deleted file", () => {
    expect(kinds(diffTables([], T("h\n1")))).toBe("aa");
    expect(kinds(diffTables(T("h\n1"), []))).toBe("rr");
  });

  it("keeps indexes into each side", () => {
    const d = diffTables(T("h\nx\n1\n2"), T("h\n1\n2\ny"));
    expect(d.map((r) => [r.kind, "oldIndex" in r ? r.oldIndex : -1, "newIndex" in r ? r.newIndex : -1])).toEqual([
      ["same", 0, 0], ["removed", 1, -1], ["same", 2, 1], ["same", 3, 2], ["added", -1, 3],
    ]);
  });

  it("skips the LCS when the middle is too big, still pairing edited rows", () => {
    const side = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 1;
    const a = Array.from({ length: side }, (_, i) => [`k${i}`, "a", "x"]);
    const b = Array.from({ length: side }, (_, i) => [`k${i}`, "b", "x"]);
    const t0 = Date.now();
    const d = diffTables(a, b);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(d.length).toBe(side);
    expect(d.every((r) => r.kind === "changed")).toBe(true);
  });

  it("similarity is the share of equal cells", () => {
    expect(similarity(["a", "b"], ["a", "c"])).toBe(0.5);
    expect(similarity([], [])).toBe(1);
    expect(similarity(["a"], ["a", "b"])).toBe(0.5);
  });

  it("changedColumns counts missing cells as empty", () => {
    expect(changedColumns(["a", "b"], ["a", "c", "d"])).toEqual([1, 2]);
    expect(changedColumns(["a", ""], ["a"])).toEqual([]);
  });
});

describe("column helpers", () => {
  it("columnCount is the widest row", () => expect(columnCount([["a"], ["a", "b", "c"], []])).toBe(3));
  it("columnWidth is clamped", () => {
    expect(columnWidth([["a"]], 0)).toBe(72);
    expect(columnWidth([["x".repeat(500)]], 0)).toBe(320);
    expect(columnWidth([["a"]], 0, "a longer header")).toBe(15 * 7 + 32);
  });
  it("diffColumnWidth counts both texts of an edited cell", () => {
    const d = diffTables([["id", "v"], ["1", "four"]], [["id", "v"], ["1", "eight!"]]);
    expect(diffColumnWidth(d, 1)).toBe(widthFor(4 + 6 + 4));
    expect(diffColumnWidth(d, 0)).toBe(widthFor(2));
  });
});
