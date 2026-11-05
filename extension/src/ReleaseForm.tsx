// The draft / edit release form (REL-8..13, 18). Decisions live in lib/releaseFormState.ts; request shapes in lib/releases.ts.
// Files are not uploaded here (uploads.github.com has no CORS): the form links to GitHub's edit page. Existing assets can be deleted.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { ContentSize } from "azure-devops-ui/Callout";
import { Panel } from "azure-devops-ui/Panel";
import { Link } from "azure-devops-ui/Link";
import { SimpleTableCell, Table } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { CommentBox } from "./CommentBox";
import { MarkdownPreview } from "./MarkdownPreview";
import { graphql, invalidateRefs, listAllBranches, listAllTags, restJson, restSend } from "./githubBrowse";
import { setEditGuard } from "./hostNav";
import { emptyForm, formButtons, formFromRelease, latestChecked, needsOverwriteConfirm, releaseErrorText, sameForm } from "./lib/releaseFormState";
import {
  defaultPreviousTag, deleteAssetRequest, formatBytes, generateNotesRequest, getReleaseRequest, isNewTag, releaseEditUrl, releaseForTag, releasesQuery, restAssetIds,
  saveReleaseRequest, toReleasesPage, validateReleaseForm, type Release, type ReleaseAsset, type ReleaseForm as Form,
} from "./lib/releases";
import "./releaseForm.css";

export interface ReleaseFormProps {
  repo: string;
  mode: "new" | "edit";
  /** New: the tag to preselect. Edit: the tag of the release being edited. */
  tag?: string;
  signedIn: boolean;
  onDone: (tagName: string) => void;
  onCancel: () => void;
}

interface Env { tags: string[]; branches: string[]; releases: Release[] }
interface Loaded { env: Env; initial: Form; previousTag: string; release?: Release; assetIds: Record<string, number>; assetError?: string }
type Ask = { title: string; text: string; confirm: string; run: () => void };

const noop = () => {};
const DISCARD: Omit<Ask, "run"> = { title: "Discard your changes?", text: "Your edits to this release have not been saved and will be lost.", confirm: "Discard changes" };

async function loadAll(repo: string, mode: "new" | "edit", tag: string | undefined): Promise<Loaded> {
  const [tags, branches] = await Promise.all([listAllTags(repo), listAllBranches(repo)]);
  const releases: Release[] = [];
  for (let after: string | null = null; releases.length < 1000; ) {
    const page = toReleasesPage((await graphql(releasesQuery(repo, after))).data);
    releases.push(...page.releases);
    if (!page.hasNextPage || !page.endCursor) break;
    after = page.endCursor;
  }
  const target = branches.defaultBranch ?? branches.branches[0]?.name ?? "";
  const env: Env = { tags: tags.tags.map((t) => t.name), branches: branches.branches.map((b) => b.name), releases };
  if (mode === "new") {
    const initial = emptyForm(tag ?? "", target);
    return { env, initial, previousTag: defaultPreviousTag(releases, initial.tagName) ?? "", assetIds: {} };
  }
  const release = releaseForTag(releases, tag ?? "");
  if (!release) throw Object.assign(new Error("not found"), { notFound: true });
  const out: Loaded = { env, initial: formFromRelease(release, target), previousTag: defaultPreviousTag(releases, release.tagName) ?? "", release, assetIds: {} };
  try {
    out.assetIds = restAssetIds((await restJson(getReleaseRequest(repo, release.databaseId))).body);
  } catch (e) {
    out.assetError = releaseErrorText("Could not load the asset ids, so files cannot be deleted here", e);
  }
  return out;
}


export function ReleaseForm({ repo, mode, tag, signedIn, onDone, onCancel }: ReleaseFormProps) {
  const [loaded, setLoaded] = React.useState<Loaded>();
  const [loadError, setLoadError] = React.useState<string>();
  const [form, setForm] = React.useState<Form>();
  const [previousTag, setPreviousTag] = React.useState("");
  const [assets, setAssets] = React.useState<ReleaseAsset[]>([]);
  const [tab, setTab] = React.useState<"write" | "preview">("write");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string>();
  const [ask, setAsk] = React.useState<Ask | null>(null);
  const [tagTouched, setTagTouched] = React.useState(false);

  React.useEffect(() => {
    if (!signedIn) return;
    let dead = false;
    loadAll(repo, mode, tag).then(
      (l) => {
        if (dead) return;
        setLoaded(l);
        setForm(l.initial);
        setPreviousTag(l.previousTag);
        setAssets(l.release?.assets ?? []);
      },
      (e) => !dead && setLoadError((e as { notFound?: boolean }).notFound ? `There is no release for the tag ${tag}. It may have been deleted.` : releaseErrorText("Could not load the release form", e))
    );
    return () => { dead = true; };
  }, [repo, mode, tag, signedIn]);

  const dirty = !!form && !!loaded && !sameForm(form, loaded.initial);
  // Navigating away from anywhere in the app asks first (hostNav's guard); a closing tab warns too.
  React.useEffect(() => {
    setEditGuard({ dirty, path: "release", ask: (proceed) => setAsk({ ...DISCARD, run: proceed }), discard: () => setEditGuard(null) });
    return () => setEditGuard(null);
  }, [dirty]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cancel = () => {
    const leave = () => { setEditGuard(null); onCancel(); };
    if (dirty) setAsk({ ...DISCARD, run: leave });
    else leave();
  };
  // A side panel over the releases list (or the release being edited), as native ADO's create and edit forms are. The address still
  // carries releaseForm, so a link or a refresh opens it again. Dismissing it is Cancel: a changed form asks first.
  const title = mode === "new" ? "Draft a new release" : "Edit release";
  const shell = (children: React.ReactNode, footer: { text: string; primary?: boolean; onClick: () => void; disabled?: boolean }[], dismiss: () => void) => (
    <Panel titleProps={{ text: title }} description={repo} size={ContentSize.Large} onDismiss={dismiss} showSeparator footerButtonProps={footer}>
      <div className="gh-rf">{children}</div>
    </Panel>
  );

  if (!signedIn || loadError || !form || !loaded) {
    return shell(
      !signedIn ? <MessageCard severity={MessageCardSeverity.Warning}>Sign in to GitHub to draft or edit releases.</MessageCard>
        : loadError ? <MessageCard severity={MessageCardSeverity.Error}>{loadError}</MessageCard>
        : <div className="flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading the release form" /></div>,
      [{ text: "Close", onClick: onCancel }],
      onCancel
    );
  }

  const { env, release } = loaded;
  const ctx = { existingTags: env.tags, releasedTags: env.releases.map((r) => r.tagName), editingTag: mode === "edit" ? release?.tagName : undefined };
  const errors = validateReleaseForm(form, ctx);
  const invalid = Object.keys(errors).length > 0;
  const fresh = isNewTag(form, ctx);
  const buttons = formButtons(mode, release?.isDraft ?? true);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f!, ...p }));
  const working = busy !== null;
  const showTagError = tagTouched || form.tagName !== "";

  const save = async (draft: boolean) => {
    if (invalid || working) return;
    setBusy(draft ? "draft" : "publish");
    setError(undefined);
    try {
      await restSend(saveReleaseRequest(repo, form, ctx, { draft, releaseId: release?.databaseId }));
      invalidateRefs(); // publishing may have created the tag
      setEditGuard(null);
      onDone(form.tagName);
    } catch (e) {
      setError(releaseErrorText(draft ? "Could not save the draft" : buttons.primary === "Update release" ? "Could not update the release" : "Could not publish the release", e));
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("generate");
    setError(undefined);
    try {
      const out = await restSend<{ name: string; body: string }>(generateNotesRequest(repo, form, ctx, previousTag || undefined));
      setForm((f) => ({ ...f!, name: f!.name.trim() ? f!.name : out.name ?? "", body: out.body ?? "" }));
    } catch (e) {
      setError(releaseErrorText("Could not generate release notes", e));
    }
    setBusy(null);
  };
  const onGenerate = () => (needsOverwriteConfirm(form.body)
    ? setAsk({ title: "Replace the notes?", text: "Generating release notes replaces what is in the notes box.", confirm: "Replace notes", run: () => void generate() })
    : void generate());

  const removeAsset = async (a: ReleaseAsset) => {
    setBusy(`asset:${a.name}`);
    setError(undefined);
    try {
      await restSend(deleteAssetRequest(repo, loaded.assetIds[a.name]));
      setAssets((l) => l.filter((x) => x.name !== a.name));
    } catch (e) {
      setError(releaseErrorText(`Could not delete ${a.name}`, e));
    }
    setBusy(null);
  };

  return shell(
    <>
      {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>{error}</MessageCard>}
      <div className="gh-rf-row">
        <div className="gh-rf-grow">
          <FormItem label="Tag" required error={showTagError && !!errors.tagName} message={showTagError && errors.tagName ? errors.tagName : fresh && form.tagName ? `${form.tagName} will be created from the target when you publish.` : undefined}>
            <div className="gh-rf-pick">
              <TextField value={form.tagName} onChange={(_e, v) => { setTagTouched(true); set({ tagName: v.trim() }); }} ariaLabel="Tag" placeholder="Type a new tag or choose one" spellCheck={false} required disabled={working} />
              <Dropdown ariaLabel="Choose an existing tag" placeholder="Existing tags" showFilterBox filterPlaceholderText="Find a tag" items={env.tags.map((t) => ({ id: t, text: t }))} onSelect={(_e, i) => { setTagTouched(true); set({ tagName: i.id }); }} disabled={working} />
            </div>
          </FormItem>
        </div>
        {fresh && (
          <div className="gh-rf-grow">
            <FormItem label="Target" required error={!!errors.target} message={errors.target ?? "The branch the new tag is created from."}>
              <Dropdown ariaLabel={`Target: ${form.target}`} placeholder={form.target || "Choose a branch"} showFilterBox filterPlaceholderText="Find a branch" items={env.branches.map((b) => ({ id: b, text: b }))} onSelect={(_e, i) => set({ target: i.id })} disabled={working} />
            </FormItem>
          </div>
        )}
        <div className="gh-rf-grow">
          <FormItem label="Previous tag" message="Used when generating release notes.">
            <Dropdown ariaLabel={`Previous tag: ${previousTag || "chosen by GitHub"}`} placeholder={previousTag || "Chosen by GitHub"} showFilterBox filterPlaceholderText="Find a tag" items={[{ id: "", text: "Chosen by GitHub" }, ...env.tags.map((t) => ({ id: t, text: t }))]} onSelect={(_e, i) => setPreviousTag(i.id)} disabled={working} />
          </FormItem>
        </div>
      </div>
      <FormItem label="Title" error={!!errors.name} message={errors.name}>
        <TextField value={form.name} onChange={(_e, v) => set({ name: v })} ariaLabel="Title" placeholder={form.tagName || "Release title"} disabled={working} />
      </FormItem>
      <FormItem label="Notes">
        <div className="gh-rf-notes-bar">
          <TabBar selectedTabId={tab} onSelectedTabChanged={(id) => setTab(id as "write" | "preview")} tabSize={TabSize.Compact}>
            <Tab id="write" name="Write" />
            <Tab id="preview" name="Preview" />
          </TabBar>
          <Button text="Generate release notes" iconProps={{ iconName: "Lightbulb" }} onClick={onGenerate} disabled={working || !form.tagName.trim() || (fresh && !form.target)} />
          {busy === "generate" && <Spinner size={SpinnerSize.small} label="Generating…" />}
        </div>
        {tab === "write"
          ? <CommentBox value={form.body} set={(v) => set({ body: v })} label="Release notes" placeholder="Describe this release" submit={noop} repo={repo} rows={14} disabled={working} />
          : <MarkdownPreview repo={repo} text={form.body} />}
      </FormItem>
      <div className="gh-rf-checks">
        <Checkbox label="Set as a pre-release" checked={form.prerelease} onChange={(_e, v) => set({ prerelease: v })} disabled={working} />
        <Checkbox label="Set as the latest release" checked={latestChecked(form)} onChange={(_e, v) => set({ makeLatest: v })} disabled={working || form.prerelease} />
      </div>
      <FormItem label="Files" message={mode === "new" ? "Save the draft, then edit it to attach files on GitHub." : undefined}>
        {assets.length > 0 && (
          <Table<ReleaseAsset>
            className="gh-rf-asset-table"
            ariaLabel="Files attached to this release"
            role="table"
            itemProvider={new ArrayItemProvider(assets)}
            columns={[
              { id: "name", name: "Name", width: -100, renderCell: (_r, i, c, a) => <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{a.name}</span></SimpleTableCell> },
              { id: "size", name: "Size", width: 120, renderCell: (_r, i, c, a) => <SimpleTableCell key="size" columnIndex={i} tableColumn={c}><span className="secondary-text">{formatBytes(a.size)}</span></SimpleTableCell> },
              {
                id: "delete", width: 48,
                renderCell: (_r, i, c, a) => (
                  <SimpleTableCell key="delete" columnIndex={i} tableColumn={c}>
                    {loaded.assetIds[a.name] !== undefined && (
                      <Button subtle iconProps={{ iconName: "Delete" }} ariaLabel={`Delete ${a.name}`} tooltipProps={{ text: `Delete ${a.name}` }} disabled={working}
                        onClick={() => setAsk({ title: "Delete this file?", text: `${a.name} will be removed from the release on GitHub. This cannot be undone.`, confirm: "Delete file", run: () => void removeAsset(a) })} />
                    )}
                  </SimpleTableCell>
                ),
              },
            ]}
          />
        )}
        {loaded.assetError && <MessageCard severity={MessageCardSeverity.Warning}>{loaded.assetError}</MessageCard>}
        {mode === "edit" && release && <Link href={releaseEditUrl(repo, release.tagName)} target="_blank" rel="noopener noreferrer">Attach files on GitHub</Link>}
      </FormItem>
      {ask && (
        <Dialog titleProps={{ text: ask.title }} onDismiss={() => setAsk(null)} footerButtonProps={[{ text: "Keep editing", onClick: () => setAsk(null) }, { text: ask.confirm, primary: true, onClick: () => { const run = ask.run; setAsk(null); run(); } }]}>
          {ask.text}
        </Dialog>
      )}
    </>,
    [
      { text: "Cancel", onClick: cancel, disabled: working },
      ...(buttons.saveDraft ? [{ text: busy === "draft" ? "Saving…" : "Save draft", onClick: () => void save(true), disabled: invalid || working }] : []),
      { text: busy === "publish" ? "Saving…" : buttons.primary, primary: true, onClick: () => void save(false), disabled: invalid || working },
    ],
    working ? () => undefined : cancel
  );
}
