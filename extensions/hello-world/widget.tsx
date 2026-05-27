import type { RefreshableBabyMenuWidget } from "../../src/shared/contracts";
import { StatusDot } from "@babymenu/ui";

const examplePrompts = [
  "add a battery widget that shows current charge and power source",
  "add a calendar widget that shows my next event and time until it starts",
  "add a cpu temp widget that shows current temperature and fan status",
];

function HelloWorldView() {
  return (
    <div className="flex flex-col gap-7 pb-2 pt-1.5">
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-1.5 text-xxs uppercase tracking-caps text-signal-live">
          <StatusDot /> ready
        </span>
        <span className="text-3xl font-light tracking-value text-ink-strong">hello world</span>
        <div className="flex flex-col gap-1">
          <p className="text-md text-ink-strong">tell baby_menu what to build.</p>
          <p className="text-base text-ink-muted">
            paste an example into the prompt below, or ask for any widget you want.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-xxs uppercase tracking-caps text-ink-label">examples</span>
        <div className="flex flex-col gap-2">
          {examplePrompts.map((example) => (
            <span
              key={example}
              className="flex items-start gap-2 rounded-sm border border-line px-3 py-2 text-sm leading-snug text-ink"
            >
              <span className="shrink-0 text-signal-live">›</span>
              <span>{example}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const helloWorldWidget: RefreshableBabyMenuWidget = {
  id: "hello-world",
  title: "baby menu",
  render: () => <HelloWorldView />,
};
