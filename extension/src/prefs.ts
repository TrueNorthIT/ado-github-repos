// Per-user preferences, in extension data at User scope (like the GitHub tokens): the graph and diff-layout toggles and the branch favourites.
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import type { IExtensionDataService } from "azure-devops-extension-api/Common/CommonServices";
import { mergeLastViewed, type LastViewedMap } from "./lib/lastViewed";

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
  /** PR Files diff layout (VW-2); unset means the built-in inline default. Kept apart from `sideBySide`, which is the commit page's. */
  prSideBySide?: boolean;
  /** "Set as compare branch": the branch each "owner/name"'s Compare action compares against instead of the default branch. */
  compareBase?: Record<string, string>;
  /** VW-9: when this user last opened each pull request, `${owner}/${name}#${number}` to an ISO time. */
  lastViewed: LastViewedMap;
  /** How a modified image is compared ("2-up", "swipe" or "onion"; lib/imageDiff.storedImageDiffMode reads it); unset means 2-up. */
  imageDiffMode?: string;
}
const DEFAULTS: Prefs = { graph: true, sideBySide: true, favourites: {}, lastViewed: {} };

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
      return { ...DEFAULTS, favourites: {}, lastViewed: {} }; // 404: nothing stored yet (or storage unavailable)
    }
  })());

/** Applies the change to the cached prefs and stores them. Resolves to the new prefs; a failed save keeps the change for this session. */
/** VW-9: notes that a pull request was opened now. Merged into the stored map, so another tab's views are not lost. */
export const recordPrViewed = (key: string, at = new Date().toISOString()) => updatePrefs((p) => ({ ...p, lastViewed: mergeLastViewed(p.lastViewed ?? {}, { [key]: at }) }));

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
