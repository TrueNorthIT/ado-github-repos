// __TN_MOCK__ Stand-in for ADO's top breadcrumb. Loads the real breadcrumb provider (src/breadcrumb.ts, which registers with the
// mock SDK) and renders whatever items it returns, so its behaviour can be seen without a real ADO page.
import { registeredService } from "./mockSdk";
import "../breadcrumb";

export async function fakeHeader() {
  const bar = document.createElement("div");
  bar.setAttribute("role", "navigation");
  bar.setAttribute("aria-label", "Mock ADO header breadcrumb");
  bar.style.cssText = "position:fixed;top:0;left:0;right:0;height:36px;z-index:50;display:flex;align-items:center;gap:6px;padding:0 16px;font:14px Segoe UI,sans-serif;background:#f3f2f1;border-bottom:1px solid #d0d0d0;color:#333";
  document.body.append(bar);
  const root = document.getElementById("root")!;
  root.style.top = "36px";
  const items = (await registeredService("github-repos-breadcrumb")) as { value: { key: string; text: string; href?: string; hidden?: boolean; iconProps?: { iconName: string } }[]; subscribe: (f: () => void) => void };
  const render = () => {
    bar.replaceChildren(document.createTextNode("demo-org / Demo Project / GitHub Repos"));
    for (const i of items.value.filter((x) => !x.hidden)) {
      bar.append(" / ");
      const a = document.createElement("a");
      a.href = i.href ?? "#";
      a.style.cssText = "color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px";
      if (i.iconProps) { const s = document.createElement("span"); s.className = `fabric-icon ms-Icon--${i.iconProps.iconName}`; a.append(s); }
      a.append(i.text);
      bar.append(a);
    }
  };
  items.subscribe(render);
  render();
}
