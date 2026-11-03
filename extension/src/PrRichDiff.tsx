// VW-11: the rendered views of a changed file: image before/after, and one side of a markdown file rendered through the sanitiser.
import * as React from "react";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import type { DiffCtx } from "./PrFiles";
import type { PrFile } from "./lib/prFiles";
import { BINARY_NOTICE, imageSources, type RenderedSide } from "./lib/richDiff";
import { prepareMarkdownHtml } from "./lib/markdown";
import { getBlobAt, getRenderedMarkdown } from "./githubBrowse";
import { openRepoHub } from "./hostNav";
import { Markdown } from "./Browser";

const MAX_IMAGE_BYTES = 10 * 1048576;
type Img = { t: "none" } | { t: "wait" } | { t: "ok"; url: string } | { t: "fail" } | { t: "large" };

function useBlobUrl(restPath: string | null, name: string): Img {
  const [img, setImg] = React.useState<Img>(restPath ? { t: "wait" } : { t: "none" });
  React.useEffect(() => {
    if (!restPath) return setImg({ t: "none" });
    let dead = false;
    let url: string | undefined;
    setImg({ t: "wait" });
    getBlobAt(restPath, name).then(
      (blob) => {
        if (dead) return;
        if (blob.size > MAX_IMAGE_BYTES) return setImg({ t: "large" });
        url = URL.createObjectURL(blob);
        setImg({ t: "ok", url });
      },
      () => !dead && setImg({ t: "fail" })
    );
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [restPath, name]);
  return img;
}

function Side({ title, img, name }: { title: string; img: Img; name: string }) {
  return (
    <figure className="gh-img-side">
      <figcaption className="body-s secondary-text font-weight-semibold">{title}</figcaption>
      {img.t === "wait" && <Spinner size={SpinnerSize.small} ariaLabel={`Loading ${title.toLowerCase()} image`} />}
      {img.t === "none" && <span className="secondary-text body-s">{title === "Before" ? "Not in the base" : "Removed"}</span>}
      {img.t === "fail" && <span className="secondary-text body-s">Could not load this image.</span>}
      {img.t === "large" && <span className="secondary-text body-s">{BINARY_NOTICE}</span>}
      {img.t === "ok" && <img className="gh-img-pic" src={img.url} alt={`${title}: ${name}`} />}
    </figure>
  );
}

/** Before and after, side by side. Both come from the contents API with the token (an <img> cannot send headers), as blob URLs revoked on unmount. */
export function ImageDiff({ file, repo, pr }: { file: PrFile; repo: string; pr: DiffCtx }) {
  const src = React.useMemo(
    () => imageSources({ repo, path: file.path, previousPath: file.previousPath, changeType: file.changeType, baseOid: pr.baseSha ?? "", headOid: pr.headSha }),
    [repo, file, pr.baseSha, pr.headSha]
  );
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const before = useBlobUrl(pr.baseSha ? src.before : null, file.previousPath ?? file.path);
  const after = useBlobUrl(src.after, file.path);
  return (
    <div className="gh-pr-diff gh-img-diff flex-row">
      <Side title="Before" img={before} name={name} />
      <Side title="After" img={after} name={name} />
    </div>
  );
}

type Md = { t: "wait" } | { t: "fail" } | { t: "ok"; prepared: ReturnType<typeof prepareMarkdownHtml>; ref: string };

/** One side of a markdown file as rendered by GitHub, then sanitised like the README and the PR description. */
export function RenderedMarkdown({ file, repo, pr, side }: { file: PrFile; repo: string; pr: DiffCtx; side: RenderedSide }) {
  const [md, setMd] = React.useState<Md>({ t: "wait" });
  const ref = side === "before" ? pr.baseSha ?? pr.headSha : pr.headSha;
  const path = side === "before" ? file.previousPath ?? file.path : file.path;
  React.useEffect(() => {
    let dead = false;
    setMd({ t: "wait" });
    const [owner, name] = repo.split("/");
    getRenderedMarkdown(repo, ref, path).then(
      (html) => !dead && setMd({ t: "ok", ref, prepared: prepareMarkdownHtml(html, { owner, name, ref, dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" }) }),
      () => !dead && setMd({ t: "fail" })
    );
    return () => { dead = true; };
  }, [repo, ref, path]);
  const go = React.useCallback((s: Parameters<typeof openRepoHub>[0]) => void openRepoHub(s), []);
  return (
    <div className="gh-pr-diff gh-md-rendered">
      {md.t === "wait" && <div className="gh-pr-diff-note flex-row justify-center"><Spinner size={SpinnerSize.small} ariaLabel="Rendering markdown" /></div>}
      {md.t === "fail" && <div className="gh-pr-diff-note secondary-text" role="status">Could not render this file.</div>}
      {md.t === "ok" && <Markdown prepared={md.prepared} repo={repo} refName={md.ref} go={go} />}
    </div>
  );
}
