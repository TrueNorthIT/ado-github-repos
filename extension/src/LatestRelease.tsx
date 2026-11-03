// The Files page's "Latest release v1.2.0 · 3 days ago" line (REQ-16). Hidden while loading, when there is none, and on any error.
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
import { RelDate } from "./RelDate";
import { getLatestRelease } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import type { BrowseState } from "./lib/browseState";

export function LatestRelease({ repo, signedIn }: { repo: string; signedIn?: boolean }) {
  const href = useHubHref();
  const [latest, setLatest] = React.useState<Awaited<ReturnType<typeof getLatestRelease>>>();
  React.useEffect(() => {
    let dead = false;
    setLatest(undefined);
    getLatestRelease(repo).then((l) => !dead && setLatest(l), () => {});
    return () => { dead = true; };
  }, [repo, signedIn]);
  if (!latest) return null;
  const s: BrowseState = { repo, tagTab: "releases", release: latest.tagName };
  return (
    <div className="gh-latest-release secondary-text body-s">
      Latest release{" "}
      <Link href={href("tags", s)} onClick={openInHub("tags", s)}>{latest.tagName}</Link>
      {" · "}
      <RelDate date={latest.publishedAt} />
    </div>
  );
}
