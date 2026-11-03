// Placeholder: the coordinator takes releases-form's version on merge.
import * as React from "react";

export function ReleaseForm(props: { repo: string; mode: "new" | "edit"; tag?: string; signedIn: boolean; onDone: (tagName: string) => void; onCancel: () => void }) {
  return <div>Release form ({props.mode} {props.tag ?? ""}) <button onClick={props.onCancel}>Cancel</button></div>;
}
