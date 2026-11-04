// The Files hub's code search box, at the end of the path bar as native Repos has one in its top bar. Enter opens GitHub's code search for
// the current repository in a new tab: GitHub's /search/code sends no CORS header, so the extension can't search in the page.
import * as React from "react";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { githubSearchUrl } from "./lib/codeSearch";

export function CodeSearchBox({ repo }: { repo: string }) {
  const [text, setText] = React.useState("");
  return (
    <TextField
      className="gh-search-box flex-noshrink"
      value={text}
      onChange={(_e, v) => setText(v)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !text.trim()) return;
        e.preventDefault();
        window.open(githubSearchUrl({ text, repos: [repo] }), "_blank", "noopener,noreferrer");
      }}
      placeholder="Search code on GitHub"
      ariaLabel={`Search the code in ${repo} on GitHub. Press Enter to open the results in a new tab.`}
      prefixIconProps={{ iconName: "Search" }}
      suffixIconProps={{ iconName: "OpenInNewTab" }}
      maxLength={256}
      width={TextFieldWidth.standard}
    />
  );
}
