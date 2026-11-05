// Entry point of the dashboard widgets and their configuration (dist/widget.html). The contribution id says which one this frame is.
// The widget contracts come from azure-devops-extension-api/Dashboard, but its helpers (WidgetStatusHelper, ConfigurationEvent)
// ship as AMD modules esbuild can't bundle, so their few values are restated here.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import type { IWidgetConfigurationContext, SaveStatus, WidgetSettings, WidgetStatus } from "azure-devops-extension-api/Dashboard/WidgetContracts";
import "azure-devops-ui/Core/override.css";
import { widgetFrame } from "./lib/widgets";
import { PrWidget, RunsWidget, WidgetConfig } from "./Widgets";
import { QueryProvider } from "./queryPersist";

/** WidgetStatusType.Success, and ConfigurationEvent.ConfigurationChange, from azure-devops-extension-api/Dashboard. */
const SUCCESS: WidgetStatus = { statusType: 0 };
const CONFIGURATION_CHANGE = "ms.vss-dashboards-web.configurationChange";

SDK.init({ loaded: false, applyTheme: true }).then(() => {
  const id = SDK.getContributionId();
  const frame = widgetFrame(id);
  const root = document.getElementById("root")!;
  if (!frame) {
    SDK.notifyLoadFailed(`Unknown widget contribution ${id}`);
    return;
  }
  let instance: object;
  if (frame.config) {
    let current = "";
    instance = {
      load: async (settings: WidgetSettings, context: IWidgetConfigurationContext): Promise<WidgetStatus> => {
        current = settings.customSettings?.data ?? "";
        const onChange = (data: string) => {
          current = data;
          void context.notify(CONFIGURATION_CHANGE, { data: { data } });
        };
        ReactDOM.render(<QueryProvider><WidgetConfig kind={frame.kind} settings={settings} onChange={onChange} /></QueryProvider>, root);
        return SUCCESS;
      },
      onSave: async (): Promise<SaveStatus> => (current ? { isValid: true, customSettings: { data: current } } : { isValid: false }),
    };
  } else {
    const Widget = frame.kind === "prs" ? PrWidget : RunsWidget;
    // Each load (and each preview change while configuring) re-renders with the new settings; the widget fetches its own data and shows
    // its own loading state, so the host is told straight away that it has painted.
    const show = async (settings: WidgetSettings): Promise<WidgetStatus> => {
      ReactDOM.render(<QueryProvider><Widget settings={settings} /></QueryProvider>, root);
      return SUCCESS;
    };
    // IConfigurableWidget names the preview hook `reload`; `reconfigure` is the same, for hosts that ask for it by that name.
    instance = { preload: async () => SUCCESS, load: show, reload: show, reconfigure: show };
  }
  // The host looks the object up by the contribution id; register both the full and the relative id.
  for (const name of new Set([id, id.slice(id.lastIndexOf(".") + 1)])) SDK.register(name, () => instance);
  void SDK.notifyLoadSucceeded();
});
