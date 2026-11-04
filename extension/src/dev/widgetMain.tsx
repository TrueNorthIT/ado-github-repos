// __TN_MOCK__ Dev-only entry point of widget.html (build.mjs --dev): installs the mocks, starts the real widget code, then plays the
// dashboard host: fetches the registered object and calls load() with settings from the address.
//   widget.html?widget=prs|runs&size=2x2&repo=owner/name&filter=all|mine|assigned&workflow=101&name=Title&scenario=signedOut
//   widget.html?widget=prs|runs&config=1   the configuration panel, with a preview frame that follows it
import { installMockFetch } from "./mockFetch";
import { registeredObject } from "./mockSdk";

installMockFetch();

const q = new URLSearchParams(location.search);
const [cols, rows] = (/^([1-6])x([1-4])$/.exec(q.get("size") ?? "") ?? [, "2", "2"]).slice(1).map(Number);
const size = { columnSpan: cols, rowSpan: rows };
const px = { width: 160 * cols + 10 * (cols - 1), height: 160 * rows + 10 * (rows - 1) }; // the dashboard grid (WidgetSizeConverter)
const kind = q.get("widget") === "runs" ? "runs" : "prs";
const data = q.get("data") ?? JSON.stringify({ repo: q.get("repo") ?? undefined, ...(kind === "prs" ? { filter: q.get("filter") ?? "all" } : { workflowId: q.get("workflow") ? Number(q.get("workflow")) : undefined }) });
const settings = { name: q.get("name") ?? "", size, customSettings: { data } };

// The dashboard: a neutral page with the widget's frame on it, sized like the grid cell it fills.
const root = document.getElementById("root")!;
const config = !!q.get("config");
const framed = window.top !== window; // the configuration page's preview frame: fill it, as on the dashboard
if (!framed) {
  document.body.style.cssText = "margin:0;background:rgba(var(--palette-neutral-2, 244, 244, 244), 1)";
  document.documentElement.style.height = "auto";
}
root.style.cssText = framed ? "width:100%;height:100%" : config
  ? "width:360px;height:auto;margin:16px;padding:16px;overflow:visible;background:var(--callout-background-color, #fff);box-shadow:0 1.6px 3.6px 0 rgba(0,0,0,.132),0 .3px .9px 0 rgba(0,0,0,.108)"
  : `width:${px.width}px;height:${px.height}px;margin:16px;box-shadow:0 1.6px 3.6px 0 rgba(0,0,0,.132),0 .3px .9px 0 rgba(0,0,0,.108)`;

let preview: HTMLIFrameElement | undefined;
const previewUrl = (d: string) => { const u = new URL(location.href); u.searchParams.delete("config"); u.searchParams.set("data", d); return u.href; };
if (config) {
  document.body.style.display = "flex";
  document.body.style.alignItems = "flex-start";
  preview = document.createElement("iframe");
  preview.title = "Widget preview";
  preview.style.cssText = `width:${px.width}px;height:${px.height}px;margin:16px;border:0;box-shadow:0 1.6px 3.6px 0 rgba(0,0,0,.132),0 .3px .9px 0 rgba(0,0,0,.108)`;
  preview.src = previewUrl(data);
  document.body.append(preview);
}

const id = `TrueNorthIT.github-repos.github-${kind}-widget${config ? "-config" : ""}`;
const started = Date.now();
void import("../widget");
const timer = setInterval(async () => {
  const obj = registeredObject(id) as any;
  if (!obj && Date.now() - started < 10000) return;
  clearInterval(timer);
  if (!obj) return console.error(`[mock host] ${id} never registered`);
  if (!config) return void obj.load(settings);
  const context = { notify: async (event: string, args: { data: { data: string } }) => {
    console.log("[mock host]", event, args.data.data);
    if (preview) preview.src = previewUrl(args.data.data);
    return { getResponse: async () => "" };
  } };
  await obj.load(settings, context);
}, 50);
