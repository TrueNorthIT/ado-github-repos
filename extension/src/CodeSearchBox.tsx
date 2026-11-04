// The Files hub's way into Code search: a search box at the end of the path bar, as native Repos has one in its top bar. Enter opens the
// Code search view (CodeSearch.tsx) for the current repository, keeping the Files address underneath so Back returns to it.
import * as React from "react";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { gotoHash } from "./hostNav";
import { serialize, type BrowseState } from "./lib/browseState";
import { applySearch, SEARCH_TEXT_MAX } from "./lib/searchHash";

export function CodeSearchBox({ state }: { state: BrowseState & { repo: string } }) {
  const [text, setText] = React.useState("");
  return (
    <TextField
      className="gh-search-box flex-noshrink"
      value={text}
      onChange={(_e, v) => setText(v)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !text.trim()) return;
        e.preventDefault();
        gotoHash(applySearch(serialize(state), { text }));
      }}
      placeholder="Search code"
      ariaLabel={`Search the code in ${state.repo}. Press Enter to search.`}
      prefixIconProps={{ iconName: "Search" }}
      maxLength={SEARCH_TEXT_MAX}
      width={TextFieldWidth.standard}
    />
  );
}
