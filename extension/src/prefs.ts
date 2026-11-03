// Per-user preferences, in extension data at User scope (like the GitHub tokens): the graph and diff-layout toggles and the branch favourites.
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import type { IExtensionDataService } from "azure-devops-extension-api/Common/CommonServices";

const COLLECTION = "github-repos-prefs";
const DOC_ID = "prefs";
const OPTS = { scopeType: "User" };

export interface Prefs {
  /** Commits page graph column: on by default. */
  graph: boolean;
  /** Commit detail diff layout: side-by-side by default, as native. */
  sideBySide: boolean;
  /** Starred branch names per "owner/name". */
  favourites: Record<string, string[]>;
}
const DEFAULTS: Prefs = { graph: true, sideBySide: true, favourites: {} };

async function store() {
  const svc = await SDK.getService<IExtensionDataService>("ms.vss-features.extension-data-service");
  return svc.getExtensionDataManager(SDK.getExtensionContext().id, await SDK.getAccessToken());
}

let loaded: Promise<Prefs> | undefined;
// Saves run one at a time, each writing the latest state, so two quick toggles cannot overwrite each other with a stale copy.
let saving: Promise<unknown> = Promise.resolve();

export const getPrefs = (): Promise<Prefs> =>
  (loaded ??= (async () => {
    try {
      return { ...DEFAULTS, ...(await (await store()).getDocument(COLLECTION, DOC_ID, OPTS)) };
    } catch {
      return { ...DEFAULTS, favourites: {} }; // 404: nothing stored yet (or storage unavailable)
    }
  })());

/** Applies the change to the cached prefs and stores them. Resolves to the new prefs; a failed save keeps the change for this session. */
export async function updatePrefs(change: (p: Prefs) => Prefs): Promise<Prefs> {
  const next = change(await getPrefs());
  loaded = Promise.resolve(next);
  saving = saving.then(async () => {
    try {
      await (await store()).setDocument(COLLECTION, { id: DOC_ID, ...next }, OPTS);
    } catch {
      /* not remembered beyond this session; the toggle still works */
    }
  });
  await saving;
  return next;
}


/** The prefs for a component: defaults until the stored copy arrives, then the stored one. `set` saves and re-renders. */
export function usePrefs(): [Prefs, (change: (p: Prefs) => Prefs) => void, boolean] {
  const [prefs, setPrefs] = React.useState<Prefs>(DEFAULTS);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let dead = false;
    getPrefs().then((p) => !dead && (setPrefs(p), setReady(true)));
    return () => { dead = true; };
  }, []);
  const set = React.useCallback((change: (p: Prefs) => Prefs) => void updatePrefs(change).then(setPrefs), []);
  return [prefs, set, ready];
}
