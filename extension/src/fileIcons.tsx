// Small inline icons for the file browser, drawn to match Azure DevOps' Repos -> Files. Used by the tree and the listing alike.
import * as React from "react";
import { Icon } from "azure-devops-ui/Icon";
import type { EntryKind } from "./lib/tree";

const svg = (children: React.ReactNode, extra?: string) => (
  <svg className={`gh-ico ${extra ?? ""}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">{children}</svg>
);
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const Page = () => <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" {...line} />;
const FOLDER = (
  <path d="M1 3.5A1 1 0 0 1 2 2.5h3.6l1.4 1.5H14a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="#dcb67a" />
);

export const RepoIcon = () => svg(<><path d="M8 .8 15.2 8 8 15.2.8 8z" fill="#e44d26" /><g {...line} stroke="#fff"><path d="M6.4 5v6M6.4 7.2h2.2a1.4 1.4 0 0 0 1.4-1.4" /><circle cx="6.4" cy="4.6" r=".6" fill="#fff" /><circle cx="6.4" cy="11.4" r=".6" fill="#fff" /><circle cx="10" cy="5.6" r=".6" fill="#fff" /></g></>);
export const BranchIcon = () => svg(<g {...line}><circle cx="4.5" cy="3.5" r="1.4" /><circle cx="4.5" cy="12.5" r="1.4" /><circle cx="11.5" cy="5.5" r="1.4" /><path d="M4.5 4.9v6.2M11.5 6.9c0 2.4-3.2 2-6.2 4.3" /></g>);
export const FolderOutlineIcon = () => svg(<path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" {...line} />);

const ext = (n: string) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);

/** The icon for a tree or listing entry. */
export function FileIcon({ name, kind }: { name: string; kind: EntryKind }) {
  if (kind === "folder") return svg(FOLDER, "gh-ico-folder");
  if (kind === "submodule") return <Icon iconName="OpenSource" className="gh-ico" />;
  const e = ext(name);
  if (e === "md" || e === "markdown")
    return svg(<g {...line}><path d="M1.5 12V4.5l2.8 3.5 2.8-3.5V12M12.5 4v7.5M10.5 9.5l2 2 2-2" /></g>);
  if (e === "yml" || e === "yaml")
    return svg(<><Page /><text x="8" y="12.6" fontSize="4.2" fontWeight="700" textAnchor="middle" fill="currentColor">YML</text></>);
  if (e === "sln" || e === "csproj" || e === "vbproj" || e === "fsproj")
    return svg(<g {...line}><rect x="1.5" y="2.5" width="12" height="9" rx="1" /><path d="M1.5 5h12M9 14l3.5-3.5M12.5 14 9 10.5" /></g>);
  if (IMAGES.has(e)) return svg(<g {...line}><Page /><path d="M4.5 13l2.6-3 1.6 1.8 1.2-1.3 2 2.5" /></g>);
  return svg(<Page />);
}
