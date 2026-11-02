import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import "azure-devops-ui/Core/override.css";
import { App } from "./App";

SDK.init({ loaded: false, applyTheme: true }).then(() => {
  ReactDOM.render(<App />, document.getElementById("root"));
  SDK.notifyLoadSucceeded();
});
