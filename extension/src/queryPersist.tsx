// Keeps the opted-in reads (useGh's `persist`, a query's meta.persist) between visits to a hub, so opening a hub again shows what it showed
// last time at once and refreshes it in the background. Each hub is its own iframe that ADO tears down on every hub switch, so without this
// every visit started cold.
//
// Stored in IndexedDB on the extension's origin (structured clone, so Dates survive), one record per ADO organisation, ADO user and hub:
// - per user, so another ADO user of the same browser never sees these rows; per hub, so two hub frames never overwrite each other's;
// - only lists and metadata opt in, never file contents, logs or blobs;
// - kept a day at most, dropped by a new extension version (the buster) and on "Sign out of GitHub" (clearPersisted).
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider, type PersistedClient, type Persister } from "@tanstack/react-query-persist-client";
import { queryClient } from "./queryClient";

const DB = "gh-repos-query-cache";
const STORE = "clients";
export const PERSIST_MAX_AGE = 24 * 60 * 60_000;
const SAVE_DELAY_MS = 1000;

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

/** A persister for one record. Saves wait for the cache to settle a second, so a burst of results is one write. Every failure is swallowed: storage blocked or full means no persistence, never a broken page. */
export function idbPersister(id: string): Persister {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    persistClient: (client: PersistedClient) => {
      clearTimeout(timer);
      timer = setTimeout(() => void tx("readwrite", (s) => void s.put(client, id)).catch(() => undefined), SAVE_DELAY_MS);
    },
    restoreClient: () => tx<PersistedClient>("readonly", (s) => s.get(id)).catch(() => undefined),
    removeClient: () => { clearTimeout(timer); return tx("readwrite", (s) => void s.delete(id)).then(() => undefined, () => undefined); },
  };
}

/** Every hub's record goes on "Sign out of GitHub": another GitHub account may see other rows. */
export const clearPersisted = (): Promise<void> => tx("readwrite", (s) => void s.clear()).then(() => undefined, () => undefined);

/** The record for this page: organisation, ADO user and contribution (the hub). Undefined when the SDK can't say, and then nothing is kept. */
function recordId(): string | undefined {
  try {
    const user = SDK.getUser()?.id;
    const host = SDK.getHost()?.id;
    const hub = SDK.getContributionId();
    return user && host && hub ? `${host}|${user}|${hub}` : undefined;
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

/** The page's query cache, restored from and saved to IndexedDB when it can be. Call after SDK.init. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const id = React.useMemo(recordId, []);
  const persister = React.useMemo(() => (id && typeof indexedDB !== "undefined" ? idbPersister(id) : undefined), [id]);
  if (!persister) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: version(),
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && q.meta?.persist === true },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
