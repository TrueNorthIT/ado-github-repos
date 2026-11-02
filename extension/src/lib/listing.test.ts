import { describe, it, expect } from "vitest";
import { formatSize, sortListing } from "./listing";
import type { TreeEntry } from "./tree";

const f = (name: string, kind: TreeEntry["kind"] = "file"): TreeEntry => ({ name, path: name, kind });

describe("formatSize", () => {
  it("is human readable", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(2621440)).toBe("2.5 MB");
  });
});

describe("sortListing", () => {
  const input = [f("b.txt"), f("A.txt"), f("zdir", "folder"), f("adir", "folder"), f("vendor", "submodule")];
  it("keeps folders (and submodules) first, ascending", () => {
    expect(sortListing(input, "asc").map((e) => e.name)).toEqual(["adir", "vendor", "zdir", "A.txt", "b.txt"]);
  });
  it("keeps folders first when descending, reversing each group", () => {
    expect(sortListing(input, "desc").map((e) => e.name)).toEqual(["zdir", "vendor", "adir", "b.txt", "A.txt"]);
  });
  it("does not mutate its input", () => {
    const copy = [...input];
    sortListing(input, "desc");
    expect(input).toEqual(copy);
  });
});
