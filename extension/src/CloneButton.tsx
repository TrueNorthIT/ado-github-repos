// The Files page's Clone button, as native Repos has in its header: a callout with the HTTPS and SSH clone URLs, each with a copy
// button, and "Clone in VS Code". Built from ExpandableButton + Callout, TabBar, a read-only TextField and ClipboardButton.
import * as React from "react";
import { Button, ExpandableButton } from "azure-devops-ui/Button";
import { Callout } from "azure-devops-ui/Callout";
import { ClipboardButton } from "azure-devops-ui/Clipboard";
import { FormItem } from "azure-devops-ui/FormItem";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { Location } from "azure-devops-ui/Utilities/Position";
import { vscodeCloneUrl, type CloneUrls } from "./lib/cloneUrls";

export function CloneButton({ urls }: { urls: CloneUrls }) {
  const [proto, setProto] = React.useState<"https" | "ssh">("https");
  const url = urls[proto];
  return (
    <ExpandableButton
      text="Clone"
      iconProps={{ iconName: "CloneToDesktop" }}
      hideDropdownIcon
      ariaLabel="Clone repository"
      renderCallout={(expandable, id, anchorElement) => (
        <Callout
          id={id}
          anchorElement={anchorElement}
          anchorOrigin={{ horizontal: Location.end, vertical: Location.end }}
          calloutOrigin={{ horizontal: Location.end, vertical: Location.start }}
          anchorOffset={{ horizontal: 0, vertical: 4 }}
          contentShadow
          lightDismiss
          escDismiss
          onDismiss={expandable.collapse}
          ariaLabel="Clone repository"
          role="dialog"
          contentClassName="gh-clone-callout flex-column"
        >
          <div className="gh-clone-title title-s">Clone repository</div>
          <TabBar ariaLabel="Clone protocol" selectedTabId={proto} onSelectedTabChanged={(t) => setProto(t as "https" | "ssh")} tabSize={TabSize.Compact} disableSticky>
            <Tab id="https" name="HTTPS" />
            <Tab id="ssh" name="SSH" />
          </TabBar>
          <FormItem label={proto === "https" ? "HTTPS clone URL" : "SSH clone URL"} className="gh-clone-url">
            <div className="flex-row flex-center gh-clone-row">
              <TextField className="flex-grow" value={url} readOnly ariaLabel={proto === "https" ? "HTTPS clone URL" : "SSH clone URL"} spellCheck={false} />
              <ClipboardButton ariaLabel={`Copy the ${proto === "https" ? "HTTPS" : "SSH"} clone URL`} getContent={() => url} showCopiedTooltip="Copied" />
            </div>
          </FormItem>
          <div className="gh-clone-ide flex-column">
            <div className="secondary-text body-s">IDE</div>
            <Button text="Clone in VS Code" iconProps={{ iconName: "OpenInNewTab" }} href={vscodeCloneUrl(url)} target="_blank" rel="noopener noreferrer" onClick={() => expandable.collapse()} />
          </div>
        </Callout>
      )}
    />
  );
}
