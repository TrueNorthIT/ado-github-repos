// GitHub's rendering of some markdown, shown as our Markdown view: the release form's Preview tab and the New pull request page's live
// preview under the description. Rendered by GitHub (POST /markdown), so it matches what the release or pull request will show.
import * as React from "react";
import { Markdown } from "./Browser";
import { renderMarkdown } from "./githubBrowse";
import { prepareMarkdownHtml, type PreparedMarkdown } from "./lib/markdown";

const noop = () => {};

/** `delay` (ms) waits for typing to pause before asking GitHub; `live` drops the box and the empty text, as native's preview under a description. */
export function MarkdownPreview({ repo, text, delay = 0, live = false }: { repo: string; text: string; delay?: number; live?: boolean }) {
  const [p, setP] = React.useState<PreparedMarkdown | "failed" | undefined>();
  React.useEffect(() => {
    if (!live) setP(undefined); // a live preview keeps the last rendering while the next is fetched
    if (!text.trim()) return setP(undefined);
    let dead = false;
    const t = setTimeout(() => renderMarkdown(repo, text).then(
      (html) => !dead && setP(prepareMarkdownHtml(html, { owner: repo.split("/")[0], name: repo.split("/")[1], ref: "HEAD", dir: "" })),
      () => !dead && setP("failed")
    ), delay);
    return () => { dead = true; clearTimeout(t); };
  }, [repo, text, delay, live]);
  const plain = (t: string, secondary = false) => <div className={secondary ? "secondary-text" : undefined} style={{ padding: live ? 0 : 12, whiteSpace: "pre-wrap" }}>{t}</div>;
  if (live) return !text.trim() ? null : <div className="gh-md-live" aria-live="polite" aria-label="Description preview">{p === "failed" ? plain(text) : p ? <Markdown prepared={p} repo={repo} refName="HEAD" go={noop} /> : null}</div>;
  return (
    <div className="gh-rf-preview" aria-live="polite">
      {!text.trim() ? plain("Nothing to preview", true) : p === "failed" ? plain(text) : !p ? plain("Loading", true) : <Markdown prepared={p} repo={repo} refName="HEAD" go={noop} />}
    </div>
  );
}
