// ALLOWED_ORIGINS parsing (production code: parseAllowedOrigins() in auth/src/handlers.ts, used by loadConfig).
// A null result makes loadConfig fail closed with the same 500 as a missing setting.
import { describe, expect, it } from "vitest";
import { parseAllowedOrigins } from "../src/handlers";
import { ORIGIN_A, ORIGIN_B } from "./helpers";

describe("REQ ALLOWED_ORIGINS: only exact https origins are accepted", () => {
  it("accepts a comma-separated list of https origins, ignoring spaces and empty entries", () => {
    expect(parseAllowedOrigins(` ${ORIGIN_A}, ${ORIGIN_B},`)).toEqual([ORIGIN_A, ORIGIN_B]);
  });

  it.each([
    ["a wildcard", "*"],
    ["null", "null"],
    ["a path", `${ORIGIN_A}/path`],
    ["a trailing slash", `${ORIGIN_A}/`],
    ["http", ORIGIN_A.replace("https://", "http://")],
    ["a non-URL", "gallerycdn.vsassets.io"],
  ])("rejects the whole list when one entry is %s", (_name, bad) => {
    expect(parseAllowedOrigins(`${ORIGIN_A},${bad}`)).toBeNull();
  });
});
