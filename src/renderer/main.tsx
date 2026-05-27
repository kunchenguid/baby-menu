import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import * as babyMenuUi from "../ui";
import { installWidgetHostShims } from "./widget-host-shim";
import "../ui/styles.css";
import "./styles.css";

if (import.meta.env.DEV) {
  void import("../ui/styles.dev.css");
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

installWidgetHostShims(window, React, jsxRuntime, babyMenuUi);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
