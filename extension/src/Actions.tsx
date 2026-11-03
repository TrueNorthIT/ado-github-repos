// The "Actions" hub (ACT-1..4, 13, 16): landing tabs (Recent | All | Runs), a workflow's runs, Run workflow. PLACEHOLDER: the lists agent replaces it.
// Routing: the page reads useHashExtras().actions (lib/actionsHash.ts); with `run` set it renders <RunPage> from ./ActionsRun.
import * as React from "react";
import type { HubProps } from "./RepoHub";
import { RepoHubPage } from "./RepoHub";

export function ActionsHub(props: HubProps) {
  return <RepoHubPage state={props.state} go={props.go}>{(repo) => <div className="page-content">Actions for {repo}</div>}</RepoHubPage>;
}
