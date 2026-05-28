import { useEffect, useRef, useState } from "react";
import type { RefreshableBabyMenuWidget } from "../../src/shared/contracts";

const examplePrompts = [
  "add a widget tracking my weekly claude code quota",
  "add a widget showing current cpu and memory usage %",
];

const COPIED_FEEDBACK_MS = 1500;

function ExampleButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }

  return (
    <button
      type="button"
      onClick={() => void copyPrompt()}
      title="Copy prompt to clipboard"
      className="group flex w-full items-start gap-2 rounded-sm border border-line px-3 py-2 text-left text-sm leading-snug text-ink transition-colors hover:border-signal-live/40 hover:bg-elevated"
    >
      <span className="shrink-0 text-signal-live">›</span>
      <span className="flex-1">{prompt}</span>
      <span
        className={`shrink-0 self-center text-xxs uppercase tracking-caps ${
          copied ? "text-signal-live" : "text-ink-faint opacity-0 group-hover:opacity-100"
        }`}
      >
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

function HelloWorldView() {
  return (
    <div className="flex flex-col gap-7 pb-2 pt-1.5">
      <div className="flex flex-col gap-3">
        <span className="text-3xl font-light tracking-value text-ink-strong">hello world</span>
        <div className="flex flex-col gap-1">
          <p className="text-md text-ink-strong">tell baby menu what you would like it to become</p>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-xxs uppercase tracking-caps text-ink-label">examples</span>
        <div className="flex flex-col gap-2">
          {examplePrompts.map((example) => (
            <ExampleButton key={example} prompt={example} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const helloWorldWidget: RefreshableBabyMenuWidget = {
  id: "hello-world",
  title: "getting started",
  render: () => <HelloWorldView />,
};
