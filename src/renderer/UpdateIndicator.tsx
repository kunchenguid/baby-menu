import { useEffect, useRef, useState } from "react";
import { Check, CircleArrowUp, Copy, ExternalLink } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  Tooltip,
} from "../ui";
import type { UpdateStatus } from "../shared/contracts";

// baby-menu is delivered only through the Homebrew cask in kunchenguid/homebrew-tap
// (see .github/workflows/release-please.yml), so this is the upgrade command we
// hand users: `brew update` refreshes the tap, then `brew upgrade --cask baby-menu`
// installs the new build. Exported so the test pins the exact string.
export const UPGRADE_COMMAND = "brew update && brew upgrade --cask baby-menu";
const UPDATE_STATUS_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Sits in the popover header next to Settings. The host runs the actual release
// check in the main process; this reads the cached status on mount and, when a
// newer version exists, opens a small dialog with the copy-paste upgrade command
// and a link to the release notes. Renders nothing (and never surfaces an error)
// when there is no update.
export function UpdateIndicator() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const next = await window.babyMenu?.app.getUpdateStatus();
        if (!cancelled && next) setStatus(next);
      } catch {
        // Best-effort: a failed check should never disrupt the shell.
      }
    }

    void refreshStatus();
    const refreshTimer = setInterval(() => void refreshStatus(), UPDATE_STATUS_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, []);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  if (!status?.updateAvailable) return null;

  async function copyCommand() {
    try {
      await navigator.clipboard?.writeText(UPGRADE_COMMAND);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the command stays visible to copy by hand.
    }
  }

  return (
    <Dialog>
      <Tooltip content={`Update available: v${status.latestVersion}`}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="w-7 px-0 text-signal-live" aria-label="update available">
            <CircleArrowUp className="size-4" />
          </Button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent className="max-w-sm">
        <DialogTitle>Update available</DialogTitle>
        <DialogDescription>
          You{"’"}re on v{status.currentVersion}. v{status.latestVersion} is available.
        </DialogDescription>
        <DialogBody className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">Run this in your terminal to update:</p>
          <div className="flex items-center gap-2 rounded-sm border border-line bg-void/40 px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate text-xs text-ink">{UPGRADE_COMMAND}</code>
            <Tooltip content={copied ? "Copied" : "Copy command"}>
              <Button
                variant="ghost"
                size="sm"
                className="w-7 shrink-0 px-0"
                aria-label="copy update command"
                onClick={() => void copyCommand()}
              >
                {copied ? <Check className="size-4 text-signal-live" /> : <Copy className="size-4" />}
              </Button>
            </Tooltip>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => void window.babyMenu?.app.openReleasePage()}>
            <ExternalLink className="size-3.5" />
            Release notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
