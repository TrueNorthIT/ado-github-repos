// Actions > Library (native ADO: Pipelines > Library, variable groups): one group per scope, the repository and then each environment, each a
// collapsible Card holding a table of its Actions variables and secrets. Variables are added, edited and deleted here; secrets are listed
// (value shown as ********, like a locked secret in native) and deleted, and set on GitHub's settings page (lib/library.ts says why).
// Variables and secrets fail separately (each needs its own GitHub App permission), so each section shows its own MessageCard.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { ContentSize } from "azure-devops-ui/Callout";
import { Dialog } from "azure-devops-ui/Dialog";
import { FormItem } from "azure-devops-ui/FormItem";
import { Icon } from "azure-devops-ui/Icon";
import type { IMenuProps } from "azure-devops-ui/Menu";
import { MenuItemType } from "azure-devops-ui/Menu";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Panel } from "azure-devops-ui/Panel";
import { ColumnMore, ITableColumn, SimpleTableCell, Table, TableColumnLayout } from "azure-devops-ui/Table";
import { TextField } from "azure-devops-ui/TextField";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import type { HubProps } from "./RepoHub";
import { skeletonRows } from "./RepoHub";
import { ErrorView } from "./Browser";
import { RelDate } from "./RelDate";
import { listEnvironmentDetails } from "./actionsApi";
import { createVariable, deleteSecret, deleteVariable, isRepoAdmin, listSecrets, listVariables, updateVariable } from "./libraryApi";
import type { Environment } from "./lib/environments";
import {
  groupRows,
  libraryProblem,
  libraryWriteError,
  nameError,
  secretsSettingsUrl,
  valueError,
  type LibRow,
  type LibSecret,
  type LibVariable,
  type Scope,
  type Section,
} from "./lib/library";

type Load<T> = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };
const SECRET_MASK = "********";

function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList): [Load<T>, () => void] {
  const [s, setS] = React.useState<Load<T>>({ t: "loading" });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setS({ t: "loading" });
    fn().then((v) => !dead && setS({ t: "ready", v }), (err) => !dead && setS({ t: "error", err }));
    return () => { dead = true; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [s, React.useCallback(() => setN((x) => x + 1), [])];
}

// ---------- the editor panel and the delete dialog ----------

type Editing = { scope: Scope; group: string; variable?: LibVariable; taken: string[] };

/** Native's variable editor as a Panel: name and value, checked against GitHub's naming rules before anything is sent. */
function VariablePanel({ repo, editing, onClose, onSaved }: { repo: string; editing: Editing; onClose: () => void; onSaved: () => void }) {
  const old = editing.variable;
  const [name, setName] = React.useState(old?.name ?? "");
  const [value, setValue] = React.useState(old?.value ?? "");
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const nameErr = nameError(name, editing.taken, old?.name);
  const valueErr = valueError(value);
  const save = async () => {
    setTried(true);
    if (nameErr || valueErr) return;
    setBusy(true);
    setError(undefined);
    try {
      if (old) await updateVariable(repo, editing.scope, old.name, name, value);
      else await createVariable(repo, editing.scope, name, value);
      onSaved();
    } catch (e) {
      setError(libraryWriteError(e, old ? "save the variable" : "add the variable", "variables"));
      setBusy(false);
    }
  };
  return (
    <Panel
      titleProps={{ text: old ? "Edit variable" : "Add variable" }}
      description={editing.group}
      size={ContentSize.Medium}
      onDismiss={busy ? () => undefined : onClose}
      showSeparator
      footerButtonProps={[
        { text: "Cancel", onClick: onClose, disabled: busy },
        { text: busy ? "Saving" : old ? "Save" : "Add", primary: true, onClick: () => void save(), disabled: busy },
      ]}
    >
      <div className="gh-act-dispatch gh-lib-editor flex-column">
        {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>{error}</MessageCard>}
        <FormItem label="Name" required error={tried && !!nameErr} message={(tried && nameErr) || "Letters, numbers and underscores. GitHub stores names in upper case."}>
          <TextField ariaLabel="Name" value={name} onChange={(_e, t) => setName(t)} disabled={busy} autoFocus={!old} inputClassName="monospaced-text" />
        </FormItem>
        <FormItem label="Value" required error={tried && !!valueErr} message={(tried && valueErr) || "Variables are stored as plain text: anyone who can read the repository's workflows can see them. Use a secret for passwords and keys."}>
          <TextField ariaLabel="Value" value={value} onChange={(_e, t) => setValue(t)} disabled={busy} multiline rows={4} autoFocus={!!old} inputClassName="monospaced-text" />
        </FormItem>
      </div>
    </Panel>
  );
}

type Deleting = { scope: Scope; group: string; name: string; secret: boolean };

function DeleteDialog({ repo, target, onClose, onDeleted }: { repo: string; target: Deleting; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const kind = target.secret ? "secret" : "variable";
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await (target.secret ? deleteSecret : deleteVariable)(repo, target.scope, target.name);
      onDeleted();
    } catch (e) {
      setError(libraryWriteError(e, `delete the ${kind}`, target.secret ? "secrets" : "variables"));
      setBusy(false);
    }
  };
  return (
    <Dialog
      titleProps={{ text: `Delete ${kind}` }}
      onDismiss={busy ? () => undefined : onClose}
      footerButtonProps={[
        { text: "Cancel", onClick: onClose, disabled: busy },
        { text: busy ? "Deleting" : "Delete", primary: true, danger: true, disabled: busy, onClick: () => void confirm() },
      ]}
    >
      <div className="flex-column gh-dialog-form">
        {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>{error}</MessageCard>}
        <div>
          Delete the {kind} <strong className="monospaced-text">{target.name}</strong> from {target.group}? Workflows that use it will no longer get a value. This cannot be undone.
        </div>
      </div>
    </Dialog>
  );
}

// ---------- one group ----------

interface GroupDef {
  key: string;
  scope: Scope;
  title: string;
  description: string;
  envId?: number;
}

function rowMenu(row: LibRow, settingsUrl: string, edit: (v: LibVariable) => void, del: (r: LibRow) => void): IMenuProps {
  return {
    id: `gh-lib-menu-${row.name}`,
    items: row.secret
      ? [
          { id: "set", text: "Set on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: settingsUrl, target: "_blank" },
          { id: "sep", itemType: MenuItemType.Divider },
          { id: "delete", text: "Delete", iconProps: { iconName: "Delete" }, onActivate: () => del(row) },
        ]
      : [
          { id: "edit", text: "Edit", iconProps: { iconName: "Edit" }, onActivate: () => edit(row) },
          { id: "delete", text: "Delete", iconProps: { iconName: "Delete" }, onActivate: () => del(row) },
        ],
  };
}

function columns(admin: boolean, settingsUrl: string, edit: (v: LibVariable) => void, del: (r: LibRow) => void): ITableColumn<LibRow>[] {
  const cols: ITableColumn<LibRow>[] = [
    {
      name: "Name", id: "name",
      width: -35,
      columnLayout: TableColumnLayout.singleLinePrefix,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="name" columnIndex={i} tableColumn={c}>
          <span className="monospaced-text text-ellipsis">{row.name}</span>
        </SimpleTableCell>
      ),
    },
    {
      name: "Value", id: "value",
      width: -65,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="value" columnIndex={i} tableColumn={c}>
          {row.secret ? (
            <span className="secondary-text flex-row flex-center" title="Secret: GitHub never shows its value">
              <span className="monospaced-text">{SECRET_MASK}</span>
              <Icon iconName="Lock" className="gh-lib-lock" ariaLabel="Secret" />
            </span>
          ) : (
            <span className="monospaced-text text-ellipsis" title={row.value}>{row.value}</span>
          )}
        </SimpleTableCell>
      ),
    },
    {
      name: "Last updated", id: "updated",
      width: 150,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="updated" columnIndex={i} tableColumn={c}>
          <span className="secondary-text"><RelDate date={row.updatedAt} /></span>
        </SimpleTableCell>
      ),
    },
  ];
  if (admin) cols.push(new ColumnMore<LibRow>((row) => rowMenu(row, settingsUrl, edit, del)));
  return cols;
}

function Problem({ e, section, retry, signIn }: { e: unknown; section: Section; retry: () => void; signIn: () => void }) {
  const p = libraryProblem(e, section);
  const buttons = p.kind === "auth" ? [{ text: "Sign in with GitHub", onClick: signIn, primary: true }] : p.kind === "permission" ? [] : [{ text: "Try again", onClick: retry }];
  return <MessageCard className="gh-lib-problem" severity={p.kind === "permission" || p.kind === "auth" ? MessageCardSeverity.Info : MessageCardSeverity.Error} buttonProps={buttons}>{p.text}</MessageCard>;
}

function Group({ repo, def, admin, props, setEditing, setDeleting, tick }: { repo: string; def: GroupDef; admin: boolean; props: HubProps; setEditing: (e: Editing) => void; setDeleting: (d: Deleting) => void; tick: number }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [vars, reloadVars] = useLoad<LibVariable[]>(() => listVariables(repo, def.scope), [repo, def.key, props.signedIn, tick]);
  const [secrets, reloadSecrets] = useLoad<LibSecret[]>(() => listSecrets(repo, def.scope), [repo, def.key, props.signedIn, tick]);
  const settingsUrl = secretsSettingsUrl(repo, def.scope, def.envId);
  const varNames = React.useMemo(() => (vars.t === "ready" ? vars.v.map((v) => v.name) : []), [vars]);
  const edit = React.useCallback((v: LibVariable) => setEditing({ scope: def.scope, group: def.title, variable: v, taken: varNames }), [def, varNames, setEditing]);
  const del = React.useCallback((r: LibRow) => setDeleting({ scope: def.scope, group: def.title, name: r.name, secret: r.secret }), [def, setDeleting]);
  const cols = React.useMemo(() => columns(admin, settingsUrl, edit, del), [admin, settingsUrl, edit, del]);
  const loading = vars.t === "loading" || secrets.t === "loading";
  const rows = React.useMemo(() => (loading ? undefined : groupRows(vars.t === "ready" ? vars.v : [], secrets.t === "ready" ? secrets.v : [])), [loading, vars, secrets]);
  const provider = React.useMemo(() => (rows ? new ArrayItemProvider(rows) : skeletonRows<LibRow>(3)), [rows]);
  const signIn = () => void props.signIn();
  const bothFailed = vars.t === "error" && secrets.t === "error";
  const counts = vars.t === "ready" || secrets.t === "ready"
    ? [vars.t === "ready" && `${vars.v.length} variable${vars.v.length === 1 ? "" : "s"}`, secrets.t === "ready" && `${secrets.v.length} secret${secrets.v.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")
    : "";
  return (
    <Card
      className="gh-pr-card bolt-table-card gh-lib-group"
      collapsible
      collapsed={collapsed}
      onCollapseClick={() => setCollapsed((c) => !c)}
      headerIconProps={{ iconName: "Library" }}
      titleProps={{ text: def.title, ariaLevel: 2 }}
      headerDescriptionProps={{ text: counts ? `${def.description} · ${counts}` : def.description }}
      headerCommandBarItems={admin ? [
        ...(vars.t === "error" ? [] : [{ id: "add", text: "Add variable", iconProps: { iconName: "Add" }, important: true, disabled: vars.t !== "ready", onActivate: () => setEditing({ scope: def.scope, group: def.title, taken: varNames }) }]),
        { id: "secret", text: "Set secret on GitHub", iconProps: { iconName: "OpenInNewTab" }, important: true, href: settingsUrl, target: "_blank" },
      ] : []}
      contentProps={{ contentPadding: false }}
    >
      <div className="flex-column flex-grow">
        {(vars.t === "error" || secrets.t === "error") && (
          <div className="gh-lib-problems flex-column">
            {vars.t === "error" && <Problem e={vars.err} section="variables" retry={reloadVars} signIn={signIn} />}
            {secrets.t === "error" && <Problem e={secrets.err} section="secrets" retry={reloadSecrets} signIn={signIn} />}
          </div>
        )}
        {bothFailed ? null : rows && !rows.length ? (
          <div className="gh-lib-empty secondary-text">No variables or secrets{def.scope.kind === "env" ? " in this environment" : ""}.</div>
        ) : (
          <Table<LibRow> ariaLabel={rows ? `${def.title} variables and secrets` : "Loading variables"} role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} singleClickActivation onActivate={admin ? (_e, r) => !r.data.secret && edit(r.data) : undefined} />
        )}
      </div>
    </Card>
  );
}

// ---------- the tab ----------

/** The Library tab's body: the repository's group, then one per environment. */
export function LibraryTab({ repo, props }: { repo: string; props: HubProps }) {
  const [adminLoad] = useLoad(() => isRepoAdmin(repo), [repo, props.signedIn]);
  const admin = adminLoad.t === "ready" && adminLoad.v;
  const [envs, reloadEnvs] = useLoad<Environment[]>(() => listEnvironmentDetails(repo), [repo, props.signedIn]);
  const [editing, setEditing] = React.useState<Editing>();
  const [deleting, setDeleting] = React.useState<Deleting>();
  const [tick, setTick] = React.useState(0);
  const groups = React.useMemo((): GroupDef[] => [
    { key: "repo", scope: { kind: "repo" }, title: "Repository", description: "Available to every workflow in the repository" },
    ...(envs.t === "ready" ? envs.v : []).map((e): GroupDef => ({ key: `env:${e.name}`, scope: { kind: "env", env: e.name }, title: e.name, description: "Environment: jobs that deploy here", envId: e.id })),
  ], [envs]);
  const saved = () => { setEditing(undefined); setDeleting(undefined); setTick((t) => t + 1); };
  return (
    <div className="flex-column gh-lib">
      {groups.map((g) => <Group key={`${repo}/${g.key}`} repo={repo} def={g} admin={admin} props={props} setEditing={setEditing} setDeleting={setDeleting} tick={tick} />)}
      {envs.t === "error" && <ErrorView err={envs.err} signIn={() => void props.signIn()} busy={props.busy} retry={reloadEnvs} subject="see this repository's environments" permission="Environments" />}
      {editing && <VariablePanel repo={repo} editing={editing} onClose={() => setEditing(undefined)} onSaved={saved} />}
      {deleting && <DeleteDialog repo={repo} target={deleting} onClose={() => setDeleting(undefined)} onDeleted={saved} />}
    </div>
  );
}
