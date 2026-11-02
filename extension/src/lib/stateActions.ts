// Which state-changing actions the header menu offers (A-4).

export type StateActionId = "markAsDraft" | "publish" | "abandon" | "reactivate";

export interface StateActionContext {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  /** PullRequest.viewerCanClose / viewerCanReopen / viewerCanUpdate. */
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  viewerCanUpdate: boolean;
}

export interface StateAction {
  id: StateActionId;
  /** Native wording: "Mark as draft", "Publish", "Abandon", "Reactivate". */
  label: string;
  enabled: boolean;
  /** Set exactly when `enabled` is false. */
  disabledReason?: string;
}

const act = (id: StateActionId, label: string, ok: boolean, why: string): StateAction => (ok ? { id, label, enabled: true } : { id, label, enabled: false, disabledReason: why });

/** Menu order: the draft toggle first, then Abandon / Reactivate. */
export function stateActions(c: StateActionContext): StateAction[] {
  if (c.state === "MERGED") return [];
  if (c.state === "CLOSED") return [act("reactivate", "Reactivate", c.viewerCanReopen, "You don't have permission to reactivate this pull request.")];
  return [
    c.isDraft
      ? act("publish", "Publish", c.viewerCanUpdate, "You don't have permission to publish this pull request.")
      : act("markAsDraft", "Mark as draft", c.viewerCanUpdate, "You don't have permission to mark this pull request as a draft."),
    act("abandon", "Abandon", c.viewerCanClose, "You don't have permission to abandon this pull request."),
  ];
}
