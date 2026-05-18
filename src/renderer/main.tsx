import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installWidgetHostShims } from "./widget-host-shim";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

installWidgetHostShims(window, React, jsxRuntime);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
