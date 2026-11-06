// Keeps the opted-in reads (useGh's `persist`, a query's meta.persist) between visits to a hub, so opening a hub again shows what it showed
// last time at once and refreshes it in the background. Each hub is its own iframe that ADO tears down on every hub switch, so without this
// every visit started cold.
//
// Stored in IndexedDB on the extension's origin (structured clone, so Dates survive), one record per ADO organisation, ADO user and project:
// - per user, so another ADO user of the same browser never sees these rows; per project, so one project's lists never show in another's;
// - every hub and dashboard widget of the project shares the record (a branch list read on Branches is there for Files): each save merges
//   its reads into the record inside one transaction, newest read wins, so frames never overwrite each other's;
// - only lists and metadata opt in, never file contents, logs or blobs;
// - kept a day at most, dropped by a new extension version (the buster) and on "Sign out of GitHub" (clearPersisted).
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { QueryClientProvider, type Query, type QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider, type PersistedClient, type Persister } from "@tanstack/react-query-persist-client";
import { keyStartsWith, onDropQueries, queryClient } from "./queryClient";

const DB = "gh-repos-query-cache";
const STORE = "clients";
export const PERSIST_MAX_AGE = 24 * 60 * 60_000;
/**
 * How soon after a change the record is written. Short, and not reset by later changes: ADO tears a hub's frame down the moment you switch
 * hubs, so a save that waited for the cache to go quiet (it was a second, restarted by every fetch and hover card) often never happened on a
 * slower page such as Tags, and the next visit started cold.
 */
const SAVE_DELAY_MS = 250;

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error("blocked"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((ok, fail) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => ok(req ? req.result : undefined);
      t.onerror = () => fail(t.error);
      t.onabort = () => fail(t.error);
    });
  } finally {
    db.close();
  }
}

type SavedQuery = PersistedClient["clientState"]["queries"][number];

/**
 * The record after a save: this frame's reads over the stored ones (the newer read of a key wins), less any older than PERSIST_MAX_AGE.
 * A stored record from another extension version is replaced, not merged.
 */
/**
 * An infinite list ("Load more") is saved with its first page only: on a revisit TanStack re-reads every page it holds, one after another,
 * so five pages loaded once would be five requests (each with its GraphQL extras) every time the hub opens.
 */
export function firstPageOnly(q: SavedQuery): SavedQuery {
  const d = q.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
  if (!d || !Array.isArray(d.pages) || !Array.isArray(d.pageParams) || d.pages.length <= 1) return q;
  return { ...q, state: { ...q.state, data: { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } } };
}

export function mergeClients(stored: PersistedClient | undefined, mine: PersistedClient, now = Date.now()): PersistedClient {
  const byHash = new Map<string, SavedQuery>();
  const keep = (q: SavedQuery) => {
    if (now - q.state.dataUpdatedAt > PERSIST_MAX_AGE) return;
    const had = byHash.get(q.queryHash);
    if (!had || had.state.dataUpdatedAt <= q.state.dataUpdatedAt) byHash.set(q.queryHash, q);
  };
  if (stored && stored.buster === mine.buster) stored.clientState.queries.forEach(keep);
  mine.clientState.queries.map(firstPageOnly).forEach(keep);
  return { timestamp: now, buster: mine.buster, clientState: { mutations: [], queries: [...byHash.values()] } };
}

/**
 * The record less any read the browser can't store (a function or a DOM object somewhere in its value). Every read of the project shares the
 * record, so one such value would otherwise fail the whole write, silently, and stop every hub's reads being kept.
 */
export function cloneable(c: PersistedClient): PersistedClient {
  try {
    structuredClone(c);
    return c;
  } catch {
    const queries = c.clientState.queries.filter((q) => {
      try {
        structuredClone(q);
        return true;
      } catch {
        console.warn("[query cache] not kept between visits, its value can't be stored:", q.queryHash);
        return false;
      }
    });
    return { ...c, clientState: { ...c.clientState, queries } };
  }
}

/** Reads the record and writes `change(record)` back in one transaction, so two frames saving at once never lose each other's reads. */
function update(id: string, change: (stored: PersistedClient | undefined) => PersistedClient | undefined): Promise<void> {
  return tx("readwrite", (s) => {
    const get = s.get(id);
    get.onsuccess = () => {
      const next = change(get.result as PersistedClient | undefined);
      if (next) s.put(cloneable(next), id);
    };
  }).then(() => undefined, () => undefined);
}

/**
 * A persister for one record. A change is written at most SAVE_DELAY_MS later, with the latest state then (a burst of results is one write),
 * merged into the record (mergeClients); `flush` writes a pending change at once (the frame is going). Every failure is swallowed: storage
 * blocked or full means no persistence, never a broken page.
 */
export function idbPersister(id: string): Persister & { forget: (prefix: QueryKey) => Promise<void>; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: PersistedClient | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    const client = latest;
    latest = undefined;
    if (client) void update(id, (stored) => mergeClients(stored, client));
  };
  return {
    persistClient: (client: PersistedClient) => {
      latest = client;
      timer ??= setTimeout(save, SAVE_DELAY_MS);
    },
    flush: save,
    /** Drops the saved reads under `prefix` (dropQueries: after a write, or Try again). */
    forget: (prefix: QueryKey) => update(id, (stored) => stored && { ...stored, clientState: { ...stored.clientState, queries: stored.clientState.queries.filter((q) => !keyStartsWith(q.queryKey, prefix)) } }),
    restoreClient: () => tx<PersistedClient>("readonly", (s) => s.get(id)).catch(() => undefined),
    removeClient: () => { clearTimeout(timer); timer = undefined; latest = undefined; return tx("readwrite", (s) => void s.delete(id)).then(() => undefined, () => undefined); },
  };
}

/** Every hub's record goes on "Sign out of GitHub": another GitHub account may see other rows. */
export const clearPersisted = (): Promise<void> => tx("readwrite", (s) => void s.clear()).then(() => undefined, () => undefined);

/** The record for this page: organisation, ADO user and project ("-" on the organisation-level pages). Undefined when the SDK can't say, and then nothing is kept. */
function recordId(): string | undefined {
  try {
    const user = SDK.getUser()?.id;
    const host = SDK.getHost()?.id;
    let project = "";
    try { project = SDK.getWebContext()?.project?.id ?? ""; } catch { /* an organisation-level page */ }
    return user && host ? `${host}|${user}|${project || "-"}` : undefined;
  } catch {
    return undefined;
  }
}

function version(): string {
  try {
    return SDK.getExtensionContext()?.version ?? "";
  } catch {
    return "";
  }
}

/** Only reads that opted in (useGh's `persist`), and only once they have succeeded. */
export const shouldPersist = (q: Query): boolean => q.state.status === "success" && q.meta?.persist === true;

/** The page's query cache, restored from and saved to IndexedDB when it can be. Call after SDK.init. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const id = React.useMemo(recordId, []);
  const persister = React.useMemo(() => {
    if (!id || typeof indexedDB === "undefined") return undefined;
    const p = idbPersister(id);
    onDropQueries((key) => void p.forget(key));
    // Switching hubs hides, then removes, this frame: write what is pending rather than lose it with the frame.
    addEventListener("pagehide", p.flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") p.flush(); });
    return p;
  }, [id]);
  if (!persister) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: version(),
        dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
      }}
      onSuccess={() => console.info(`[query cache] restored ${queryClient.getQueryCache().getAll().filter((q) => q.state.dataUpdatedAt > 0).length} saved reads`)}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
