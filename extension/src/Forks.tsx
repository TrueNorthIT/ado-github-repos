// The Forks page (Branches hub, "..." > Forks; hash view=forks): the forks of the repository the viewer can see, with owner, last push and
// behind / ahead of the parent's default branch, each linking to GitHub; and "Fork" with a confirm dialog. The logic is in lib/forks.ts.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MoreButton } from "azure-devops-ui/Menu";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { SimpleTableCell, Table, TableColumnLayout, type ITableColumn } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { RelDate } from "./RelDate";
import { BehindAhead } from "./Branches";
import { ErrorView } from "./Browser";
import { type HubProps, skeletonRows, titleSwitcher } from "./RepoHub";
import { GhError, createFork, getForkAheadBehind, getRepo, getViewerLogin, getViewerOrgs, invalidateForks, listForks } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import { inBatches, maxDivergence, type AheadBehind } from "./lib/branches";
import { applySourceRepo, githubForkUrl, type Fork } from "./lib/forks";
import { serializeNewPr } from "./lib/newPrHash";
import "./browser.css";


const COMPARE_BATCH = 6;
/** The Owner dropdown's id for the viewer's own account (no organization in the request). */
const ME = "@me";
type Row = Fork;

/** Why GitHub refused to create a fork, in words: a GitHub App can only create repositories where it is allowed to. */
function forkErrorText(e: unknown): string {
  if (e instanceof GhError) {
    if (e.kind === "auth") return "Your GitHub sign-in has expired. Sign in again to continue.";
    if (e.kind === "access" || e.status === 422) return `GitHub didn't let the extension create the fork${e.apiMessage ? ` (${e.apiMessage.replace(/\.$/, "")})` : ""}. The GitHub App may not be allowed to create repositories under that account; you can fork on GitHub instead.`;
    if (e.kind === "rateLimit") return "GitHub's rate limit has been reached. Try again later.";
    if (e.apiMessage) return `GitHub said: ${e.apiMessage}`;
  }
  return "Could not reach GitHub. Try again.";
}

/** Confirm before creating a repository: forking makes a new repository under the viewer's account or an organisation they pick. */
function ForkDialog({ repo, close, done }: { repo: string; close: () => void; done: (made: Fork | null, where: string) => void }) {
  const [owners, setOwners] = React.useState<{ id: string; text: string }[] | null>(null);
  const [owner, setOwner] = React.useState<string>("");
  const [onlyDefault, setOnlyDefault] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const selection = React.useRef(new DropdownSelection());
  React.useEffect(() => {
    let dead = false;
    Promise.all([getViewerLogin().catch(() => ""), getViewerOrgs()]).then(([me, orgs]) => {
      if (dead) return;
      const items = [...(me ? [{ id: ME, text: `${me} (your account)` }] : []), ...orgs.map((o) => ({ id: o, text: o }))];
      setOwners(items);
      setOwner(items[0]?.id ?? ME);
      selection.current.select(0);
    }, () => !dead && setOwners([]));
    return () => { dead = true; };
  }, [repo]);
  const name = repo.split("/")[1];
  const where = owners?.find((o) => o.id === owner)?.text.replace(/ \(your account\)$/, "") ?? "";
  const confirm = () => {
    setBusy(true);
    setError(undefined);
    createFork(repo, { organization: owner === ME ? undefined : owner, defaultBranchOnly: onlyDefault }).then(
      (made) => done(made, where),
      (e) => (setBusy(false), setError(forkErrorText(e)))
    );
  };
  return (
    <Dialog
      titleProps={{ text: "Fork repository" }}
      onDismiss={() => !busy && close()}
      footerButtonProps={[{ text: "Cancel", onClick: close, disabled: busy }, { text: busy ? "Forking…" : "Fork", primary: true, disabled: busy || !owners?.length, onClick: confirm }]}
    >
      <div className="flex-column gh-fork-dialog">
        <p className="body-m">This creates a new repository, <b>{where ? `${where}/${name}` : name}</b>, on GitHub under your account or the organisation you choose, copying {repo}. You can delete it on GitHub later.</p>
        <FormItem label="Owner">
          <Dropdown ariaLabel="Owner of the new fork" items={owners ?? []} selection={selection.current} placeholder={owners === null ? "Loading…" : "No account available"} disabled={busy || !owners?.length} onSelect={(_e, i) => setOwner(i.id)} />
        </FormItem>
        <Checkbox label="Copy the default branch only" checked={onlyDefault} disabled={busy} onChange={(_e, c) => setOnlyDefault(c)} />
        {error && (
          <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>
            {error} <Link href={githubForkUrl(repo)} target="_blank" rel="noopener noreferrer">Fork on GitHub</Link>
          </MessageCard>
        )}
      </div>
    </Dialog>
  );
}

export function ForksView({ repo, props }: { repo: string; props: HubProps }) {
  const { go, openSwitch, signedIn } = props;
  const href = useHubHref();
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; forks: Fork[]; base: string }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [compares, setCompares] = React.useState<Record<string, AheadBehind | null>>({});
  const [dialog, setDialog] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    setCompares({});
    Promise.all([listForks(repo), getRepo(repo)]).then(([forks, info]) => !dead && setData({ t: "ready", forks, base: info.defaultBranch }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, signedIn, reload]);

  // Behind / ahead a few at a time, as the Branches page does.
  const ready = data.t === "ready" ? data : undefined;
  React.useEffect(() => {
    if (!ready) return;
    let dead = false;
    (async () => {
      for (const batch of inBatches(ready.forks, COMPARE_BATCH)) {
        const got = await Promise.all(batch.map((f) => getForkAheadBehind(repo, ready.base, f).then((ab) => [f.fullName, ab] as const, () => [f.fullName, null] as const)));
        if (dead) return;
        setCompares((c) => ({ ...c, ...Object.fromEntries(got) }));
      }
    })();
    return () => { dead = true; };
  }, [ready, repo]);

  const max = maxDivergence(Object.values(compares).map((v) => v ?? undefined));
  const columns = React.useMemo<ITableColumn<Row>[]>(() => [
    {
      id: "repo", name: "Repository", width: -100, columnLayout: TableColumnLayout.singleLinePrefix,
      renderCell: (_r, i, col, f) => (
        <SimpleTableCell key="repo" columnIndex={i} tableColumn={col}>
          <span className="flex-row flex-center gh-fork-name">
            <VssPersona imageUrl={f.ownerAvatar} displayName={f.owner} size="small" suppressPersonaCard showInitialsOnImageError />
            <Link className="bolt-table-link text-ellipsis" href={f.htmlUrl} target="_blank" rel="noopener noreferrer" subtle removeUnderline ariaLabel={`${f.fullName} on GitHub`}>{f.fullName}</Link>
            {f.isPrivate && <Pill size={PillSize.compact} variant={PillVariant.outlined}>Private</Pill>}
          </span>
        </SimpleTableCell>
      ),
    },
    { id: "owner", name: "Owner", width: 220, renderCell: (_r, i, col, f) => <SimpleTableCell key="owner" columnIndex={i} tableColumn={col}><span className="text-ellipsis">{f.owner}{f.ownerType === "Organization" ? <span className="secondary-text"> (organisation)</span> : null}</span></SimpleTableCell> },
    { id: "push", name: "Last push", width: 150, renderCell: (_r, i, col, f) => <SimpleTableCell key="push" columnIndex={i} tableColumn={col}>{f.pushedAt ? <RelDate date={f.pushedAt} /> : <span className="secondary-text">Never</span>}</SimpleTableCell> },
    {
      id: "ba", name: `Behind | Ahead${ready ? ` (${ready.base})` : ""}`, width: 170,
      renderCell: (_r, i, col, f) => (
        <SimpleTableCell key="ba" columnIndex={i} tableColumn={col}>
          {compares[f.fullName] === null ? <span className="secondary-text" title="GitHub couldn't compare this fork">–</span> : <BehindAhead value={compares[f.fullName] ?? undefined} max={max} />}
        </SimpleTableCell>
      ),
    },
    {
      id: "more", name: "", width: 48,
      renderCell: (_r, i, col, f) => {
        const pr = applySourceRepo(serializeNewPr({ repo, source: f.defaultBranch }), f.fullName);
        return (
          <SimpleTableCell key="more" columnIndex={i} tableColumn={col}>
            <MoreButton
              ariaLabel={`Actions for ${f.fullName}`}
              contextualMenuProps={{
                menuProps: {
                  id: `gh-fork-menu-${f.fullName}`,
                  items: [
                    { id: "github", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: f.htmlUrl, target: "_blank", onActivate: () => void window.open(f.htmlUrl, "_blank", "noopener") },
                    { id: "pr", text: "New pull request", iconProps: { iconName: "BranchPullRequest" }, href: href("prs", pr), onActivate: openInHub("prs", pr) as any, disabled: (compares[f.fullName]?.ahead ?? 1) === 0 },
                  ],
                },
              }}
            />
          </SimpleTableCell>
        );
      },
    },
  ], [compares, max, ready, repo, href]);
  const provider = React.useMemo(() => new ArrayItemProvider(ready?.forks ?? []), [ready, compares]); // the cells read compares: a new provider re-renders them

  return (
    <>
      <Header
        className="gh-hub-header"
        title="Forks"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "back", text: "Branches", important: true, iconProps: { iconName: "Back" }, onActivate: () => go({ repo }) },
          { id: "fork", text: "Fork", isPrimary: true, important: true, iconProps: { iconName: "GitFork" }, onActivate: () => setDialog(true) },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(undefined)}>{notice}</MessageCard>}
        {data.t === "error" ? (
          <ErrorView err={data.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateForks(); setReload((n) => n + 1); }} subject="see this repository's forks" permission="Metadata" />
        ) : ready && !ready.forks.length ? (
          <ZeroData iconProps={{ iconName: "GitFork" }} imageAltText="" primaryText="No forks" secondaryText="Nobody has forked this repository, or you can't see the forks." />
        ) : (
          <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
            <Table<Row> ariaLabel="Forks" role="table" columns={columns} itemProvider={ready ? provider : skeletonRows<Row>(4)} spacerWidth={8} />
          </Card>
        )}
      </div>
      {dialog && (
        <ForkDialog
          repo={repo}
          close={() => setDialog(false)}
          done={(made, where) => {
            setDialog(false);
            setNotice(`Forked to ${made?.fullName ?? `${where}/${repo.split("/")[1]}`}. GitHub can take a few minutes to finish copying it.`);
            invalidateForks();
            setReload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
