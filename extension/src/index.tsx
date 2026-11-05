import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import "azure-devops-ui/Core/override.css";
import { App } from "./App";
import { MyPrsHub } from "./MyPrsHub";
import { MY_PRS_HUB } from "./myPrsShared";
import { QueryProvider } from "./queryPersist";

SDK.init({ loaded: false, applyTheme: true }).then(() => {
  // Every hub loads hub.html; the organisation-level GitHub pull requests page is the one that is not a repository hub.
  ReactDOM.render(<QueryProvider>{SDK.getContributionId().endsWith(`.${MY_PRS_HUB}`) ? <MyPrsHub /> : <App />}</QueryProvider>, document.getElementById("root"));
  SDK.notifyLoadSucceeded();
});
