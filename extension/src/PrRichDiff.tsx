// VW-11: the rendered views of a changed file: image before/after, and one side of a markdown file rendered through the sanitiser.
import * as React from "react";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import type { DiffCtx } from "./PrFiles";
import type { PrFile } from "./lib/prFiles";
import { BINARY_NOTICE, imageSources, type RenderedSide } from "./lib/richDiff";
import { prepareMarkdownHtml } from "./lib/markdown";
import { DEFAULT_IMAGE_DIFF_MODE, DEFAULT_OPACITY, DEFAULT_SWIPE, IMAGE_DIFF_MODES, clampPercent, fitScale, frameSize, hasBothSides, imageLabel, naturalSize, scaled, storedImageDiffMode, twoUpScale, type ImageDiffMode, type Size } from "./lib/imageDiff";
import { getBlobAt, getRenderedMarkdown } from "./githubBrowse";
import { getPrefs, updatePrefs } from "./prefs";
import { openRepoHub } from "./hostNav";
import { Markdown } from "./Browser";

const MAX_IMAGE_BYTES = 10 * 1048576;
type Img = { t: "none" } | { t: "wait" } | { t: "ok"; url: string; bytes: number } | { t: "fail" } | { t: "large" };

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
        setImg({ t: "ok", url, bytes: blob.size });
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

// The chosen mode is one per user and applies to every image on the page: each ImageDiff subscribes here, and a change reaches them all and is stored in prefs.
let modeNow: ImageDiffMode | undefined;
const modeSubs = new Set<(m: ImageDiffMode) => void>();
const announce = (m: ImageDiffMode) => modeSubs.forEach((f) => f(m));

function useImageDiffMode(): [ImageDiffMode, (m: ImageDiffMode) => void] {
  const [mode, setMode] = React.useState<ImageDiffMode>(modeNow ?? DEFAULT_IMAGE_DIFF_MODE);
  React.useEffect(() => {
    modeSubs.add(setMode);
    if (modeNow) setMode(modeNow);
    else void getPrefs().then((p) => { if (!modeNow) { modeNow = storedImageDiffMode(p.imageDiffMode); announce(modeNow); } });
    return () => { modeSubs.delete(setMode); };
  }, []);
  const set = React.useCallback((m: ImageDiffMode) => {
    modeNow = m;
    announce(m);
    void updatePrefs((p) => ({ ...p, imageDiffMode: m }));
  }, []);
  return [mode, set];
}

/** The width available to the image views, kept up to date as the card resizes. */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** VW-11: the 2-up / Swipe / Onion skin switcher, a ButtonGroup like the Source / Rendered toggle. */
function ModeToggle({ mode, setMode, name }: { mode: ImageDiffMode; setMode: (m: ImageDiffMode) => void; name: string }) {
  return (
    <div role="group" aria-label={`Compare ${name}`} className="gh-img-modes">
      <ButtonGroup className="gh-view-toggle">
        {IMAGE_DIFF_MODES.map((m) => <Button key={m.id} subtle={m.id !== mode} primary={m.id === mode} text={m.label} ariaPressed={m.id === mode} ariaLabel={`${m.label} comparison of ${name}`} onClick={() => setMode(m.id)} />)}
      </ButtonGroup>
    </div>
  );
}

/** A 0–100 slider. azure-devops-ui has no slider, so this is a native range input, labelled, with its value shown beside it. */
function PercentSlider({ label, value, onChange, valueText }: { label: string; value: number; onChange: (v: number) => void; valueText: string }) {
  const id = React.useMemo(() => `gh-img-slider-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="gh-img-slider flex-row flex-center">
      <label htmlFor={id} className="body-s secondary-text">{label}</label>
      <input id={id} type="range" min={0} max={100} step={1} value={value} aria-valuetext={valueText} onChange={(e) => onChange(clampPercent(e.currentTarget.value))} />
      <output htmlFor={id} className="body-s" aria-live="off">{valueText}</output>
    </div>
  );
}

type Loaded = { url: string; bytes: number; size?: Size };

function Caption({ title, img }: { title: string; img: Loaded }) {
  return (
    <figcaption className="flex-column">
      <span className="body-s font-weight-semibold">{title}</span>
      <span className="body-s secondary-text">{imageLabel(img.size, img.bytes) || "\u00a0"}</span>
    </figcaption>
  );
}

/** Both sides loaded: the chosen mode. Sizes arrive as each <img> loads; until then the image is drawn unscaled within its box. */
function Compare({ before, after, name }: { before: { url: string; bytes: number }; after: { url: string; bytes: number }; name: string }) {
  const [mode, setMode] = useImageDiffMode();
  const [ref, width] = useWidth();
  const [sizes, setSizes] = React.useState<{ before?: Size; after?: Size }>({});
  const [opacity, setOpacity] = React.useState(DEFAULT_OPACITY);
  const [swipe, setSwipe] = React.useState(DEFAULT_SWIPE);
  const onLoad = (side: "before" | "after") => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const size = naturalSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
    setSizes((s) => (s[side]?.w === size.w && s[side]?.h === size.h ? s : { ...s, [side]: size }));
  };
  const b: Loaded = { ...before, size: sizes.before };
  const a: Loaded = { ...after, size: sizes.after };
  const known = sizes.before && sizes.after ? { before: sizes.before, after: sizes.after } : undefined;
  const pic = (side: "before" | "after", img: Loaded, dims?: Size, style?: React.CSSProperties) => (
    <img className={dims ? "gh-img-pic gh-img-sized" : "gh-img-pic"} src={img.url} alt={`${side === "before" ? "Before" : "After"}: ${name}`} onLoad={onLoad(side)} width={dims?.w} height={dims?.h} style={style} draggable={false} />
  );

  let body: React.ReactNode;
  if (mode === "2-up") {
    const k = known ? twoUpScale(known.before, known.after, width) : 1;
    body = (
      <div className="gh-img-2up flex-row">
        <figure className="gh-img-side">{pic("before", b, known && scaled(known.before, k))}<Caption title="Before" img={b} /></figure>
        <figure className="gh-img-side">{pic("after", a, known && scaled(known.after, k))}<Caption title="After" img={a} /></figure>
      </div>
    );
  } else {
    const frame = known ? frameSize(known.before, known.after) : { w: 300, h: 150 };
    const k = fitScale(frame, width);
    const box = scaled(frame, k);
    const place = (s: Size | undefined): React.CSSProperties => {
      if (!s) return { visibility: "hidden" };
      const d = scaled(s, k);
      return { left: Math.round((box.w - d.w) / 2), top: Math.round((box.h - d.h) / 2) };
    };
    const onion = mode === "onion";
    body = (
      <div className="gh-img-stack flex-column">
        <div className="gh-img-frame gh-img-checker" style={{ width: box.w, height: box.h }} role="img" aria-label={onion ? `Onion skin of ${name}: after over before at ${opacity}%` : `Swipe of ${name}: before left of ${swipe}%, after right`}>
          {pic("before", b, known && scaled(known.before, k), place(sizes.before))}
          <div className="gh-img-layer" style={onion ? { opacity: opacity / 100 } : { clipPath: `inset(0 0 0 ${swipe}%)` }}>
            {pic("after", a, known && scaled(known.after, k), place(sizes.after))}
          </div>
          {!onion && <div className="gh-img-divider" style={{ left: `${swipe}%` }} aria-hidden="true" />}
        </div>
        {onion
          ? <PercentSlider label="After opacity" value={opacity} onChange={setOpacity} valueText={`${opacity}%`} />
          : <PercentSlider label="Swipe" value={swipe} onChange={setSwipe} valueText={`${swipe}%`} />}
        <div className="gh-img-captions flex-row">
          <Caption title="Before" img={b} />
          <Caption title="After" img={a} />
        </div>
      </div>
    );
  }
  return (
    <div className="gh-pr-diff gh-img-compare flex-column" ref={ref}>
      <ModeToggle mode={mode} setMode={setMode} name={name} />
      {body}
    </div>
  );
}

/**
 * Before and after. Both come from the contents API with the token (an <img> cannot send headers), as blob URLs revoked on unmount.
 * A modified image, once both sides load, offers 2-up, Swipe and Onion skin; an added or deleted one (or a side still loading or failed) shows the two sides as before.
 */
export function ImageDiff({ file, repo, pr }: { file: PrFile; repo: string; pr: DiffCtx }) {
  const src = React.useMemo(
    () => imageSources({ repo, path: file.path, previousPath: file.previousPath, changeType: file.changeType, baseOid: pr.baseSha ?? "", headOid: pr.headSha }),
    [repo, file, pr.baseSha, pr.headSha]
  );
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const before = useBlobUrl(pr.baseSha ? src.before : null, file.previousPath ?? file.path);
  const after = useBlobUrl(src.after, file.path);
  if (hasBothSides(file.changeType) && before.t === "ok" && after.t === "ok") return <Compare before={before} after={after} name={name} />;
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
