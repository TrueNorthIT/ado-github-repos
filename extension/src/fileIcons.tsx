// Icons for the file browser. Everything is azure-devops-ui's own Icon (its bundled Fluent/Fabric fonts, the same glyphs
// as Repos -> Files) except RepoIcon, which is the Azure Repos product logo and has no glyph in the font.
import * as React from "react";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import type { EntryKind } from "./lib/tree";

// ponytail: the product logo is an SVG; no font glyph carries the red Repos diamond.
export const RepoIcon = () => (
  <svg className="flex-noshrink" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 .8 15.2 8 8 15.2.8 8z" fill="#e44d26" />
    <g fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.4 5v6M6.4 7.2h2.2a1.4 1.4 0 0 0 1.4-1.4" />
      <circle cx="6.4" cy="4.6" r=".6" fill="#fff" />
      <circle cx="6.4" cy="11.4" r=".6" fill="#fff" />
      <circle cx="10" cy="5.6" r=".6" fill="#fff" />
    </g>
  </svg>
);

// IconSize.medium is a real enum member at runtime (not a const enum), so it is safe to import from esbuild.
const ico = (iconName: string, className?: string) => <Icon iconName={iconName} size={IconSize.medium} className={className} />;

export const FolderOutlineIcon = () => ico("FabricFolder");

const ext = (n: string) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "");
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);

/** The icon for a tree or listing entry. */
export function FileIcon({ name, kind }: { name: string; kind: EntryKind }) {
  if (kind === "folder") return ico("FabricFolderFill", "gh-ico-folder");
  if (kind === "submodule") return ico("OpenSource");
  const e = ext(name);
  if (e === "md" || e === "markdown") return ico("MarkDownLanguage");
  if (e === "yml" || e === "yaml") return ico("FileYML");
  if (e === "sln" || e === "csproj" || e === "vbproj" || e === "fsproj") return ico("FileTypeSolution");
  if (IMAGES.has(e)) return ico("FileImage");
  return ico("Page");
}
