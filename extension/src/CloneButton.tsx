// The Files page's Clone button, as native Repos has in its header. Native opens a 480px Panel, "Clone Repository": a "Command line"
// row of HTTPS / SSH buttons (the chosen one primary), the read-only URL and its copy button, a "Learn more" link, then an "IDE" row
// with "Clone in VS Code". Built from Button, Panel, FormItem, a read-only TextField, ClipboardButton and Link.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { ClipboardButton } from "azure-devops-ui/Clipboard";
import { ContentSize } from "azure-devops-ui/Callout";
import { FormItem } from "azure-devops-ui/FormItem";
import { Link } from "azure-devops-ui/Link";
import { Panel } from "azure-devops-ui/Panel";
import { TextField } from "azure-devops-ui/TextField";
import { vscodeCloneUrl, type CloneUrls } from "./lib/cloneUrls";

const LEARN_MORE = {
  https: "https://docs.github.com/en/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls",
  ssh: "https://docs.github.com/en/authentication/connecting-to-github-with-ssh",
};

export function CloneButton({ urls }: { urls: CloneUrls }) {
  const [open, setOpen] = React.useState(false);
  const [proto, setProto] = React.useState<"https" | "ssh">("https");
  const url = urls[proto];
  const label = proto === "https" ? "HTTPS" : "SSH";
  return (
    <>
      <Button text="Clone" iconProps={{ iconName: "CloneToDesktop" }} ariaLabel="Clone repository" onClick={() => setOpen(true)} />
      {open && (
        <Panel titleProps={{ text: "Clone Repository" }} size={ContentSize.Medium} onDismiss={() => setOpen(false)} lightDismiss>
          <div className="flex-column flex-grow rhythm-vertical-24">
            <FormItem label="Command line">
              <div className="flex-row flex-center">
                <div className="flex-row flex-center gh-clone-protocols" role="group" aria-label="Clone protocol">
                  <Button text="HTTPS" primary={proto === "https"} ariaPressed={proto === "https"} onClick={() => setProto("https")} />
                  <Button text="SSH" primary={proto === "ssh"} ariaPressed={proto === "ssh"} onClick={() => setProto("ssh")} />
                </div>
                <TextField containerClassName="flex-grow" className="flex-grow" value={url} readOnly ariaLabel={`${label} clone URL`} spellCheck={false} />
                <ClipboardButton className="margin-left-4" ariaLabel={`Copy the ${label} clone URL`} getContent={() => url} showCopiedTooltip="Copied" />
              </div>
              <Link className="gh-clone-learn" href={LEARN_MORE[proto]} target="_blank" rel="noopener noreferrer">Learn more about {label}</Link>
            </FormItem>
            <FormItem label="IDE">
              <div className="flex-row">
                <Button text="Clone in VS Code" iconProps={{ iconName: "CloneToDesktop" }} href={vscodeCloneUrl(url)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} />
              </div>
            </FormItem>
          </div>
        </Panel>
      )}
    </>
  );
}
