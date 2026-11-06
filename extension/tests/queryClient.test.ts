import { describe, expect, it, vi } from "vitest";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { forgetRefused, keyStartsWith, onDropQueries } from "../src/queryClient";

const gh = (kind: string, status = 0) => Object.assign(new Error(kind), { kind, status });

/** A client whose cache clears refused reads as the page's does, with one read that first succeeds and then fails with `err`. */
async function refreshFails(err: Error) {
  const qc = new QueryClient({ queryCache: new QueryCache({ onError: forgetRefused }), defaultOptions: { queries: { retry: false } } });
  let fail = false;
  const fn = () => (fail ? Promise.reject(err) : Promise.resolve(["row"]));
  await qc.fetchQuery({ queryKey: ["refs", "branches", "a/b"], queryFn: fn });
  fail = true;
  await qc.fetchQuery({ queryKey: ["refs", "branches", "a/b"], queryFn: fn, staleTime: 0 }).catch(() => undefined);
  return qc.getQueryState(["refs", "branches", "a/b"])!;
}

describe("forgetRefused", () => {
  const dropped: unknown[][] = [];
  onDropQueries((k) => void dropped.push(k as unknown[]));

  it("a lapsed sign-in clears what the read showed, and every saved read", async () => {
    dropped.length = 0;
    const s = await refreshFails(gh("auth", 401));
    expect(s.data).toBeUndefined();
    expect(s.status).toBe("error");
    expect(dropped).toEqual([[]]);
  });

  it("a refused read clears what it showed, and only its own saved copy", async () => {
    dropped.length = 0;
    const s = await refreshFails(gh("access", 404));
    expect(s.data).toBeUndefined();
    expect(dropped).toEqual([["refs", "branches", "a/b"]]);
  });

  it("a rate limit or a network failure keeps what is shown", async () => {
    dropped.length = 0;
    expect((await refreshFails(gh("rateLimit", 403))).data).toEqual(["row"]);
    expect((await refreshFails(gh("other", 0))).data).toEqual(["row"]);
    expect(dropped).toEqual([]);
  });
});

describe("keyStartsWith", () => {
  it("matches whole elements from the start", () => {
    expect(keyStartsWith(["refs", "branches", "a/b"], ["refs"])).toBe(true);
    expect(keyStartsWith(["refs", "branches", "a/b"], [])).toBe(true);
    expect(keyStartsWith(["refsx"], ["refs"])).toBe(false);
    expect(keyStartsWith(["pr", "a/b", 3, "page"], ["pr", "a/b", 3])).toBe(true);
    expect(keyStartsWith(["pr", "a/b", 3], ["pr", "a/b", "3"])).toBe(false);
    expect(keyStartsWith(["refs"], ["refs", "branches"])).toBe(false);
  });
});
