import type { RefreshableBabyMenuWidget } from "@babymenu/contracts";
import { HelloWorldView } from "./components";

// The widget descriptor is a plain object (not a React component), so editing
// THIS file triggers a full reload. Author your UI in components.tsx, which Vite
// Fast Refreshes in place and keeps component state across edits.
export const helloWorldWidget: RefreshableBabyMenuWidget = {
  id: "hello-world",
  title: "getting started",
  render: () => <HelloWorldView />,
};
