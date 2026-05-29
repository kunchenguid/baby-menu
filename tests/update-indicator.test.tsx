// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/contracts";
import { UPGRADE_COMMAND, UpdateIndicator } from "../src/renderer/UpdateIndicator";

function stubApp(status: UpdateStatus) {
  const openReleasePage = vi.fn(async () => ({ ok: true }));
  const getUpdateStatus = vi.fn(async () => status);
  (window as unknown as { babyMenu: unknown }).babyMenu = { app: { getUpdateStatus, openReleasePage } };
  return { getUpdateStatus, openReleasePage };
}

const updateAvailable: UpdateStatus = {
  currentVersion: "0.1.7",
  latestVersion: "0.2.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/kunchenguid/baby-menu/releases/tag/v0.2.0",
};

describe("UpdateIndicator", () => {
  afterEach(() => {
    cleanup();
    (window as unknown as { babyMenu?: unknown }).babyMenu = undefined;
  });

  it("renders nothing when no update is available", async () => {
    const { getUpdateStatus } = stubApp({
      currentVersion: "0.1.7",
      latestVersion: "0.1.7",
      updateAvailable: false,
      releaseUrl: null,
    });

    const { container } = render(<UpdateIndicator />);
    await waitFor(() => expect(getUpdateStatus).toHaveBeenCalled());
    expect(container.querySelector('[aria-label="update available"]')).toBeNull();
  });

  it("opens a dialog with the homebrew upgrade command", async () => {
    stubApp(updateAvailable);

    const { findByLabelText, findByText } = render(<UpdateIndicator />);
    fireEvent.click(await findByLabelText("update available"));

    await findByText(UPGRADE_COMMAND);
    expect(UPGRADE_COMMAND).toBe("brew update && brew upgrade --cask baby-menu");
  });

  it("copies the upgrade command to the clipboard", async () => {
    stubApp(updateAvailable);
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { findByLabelText } = render(<UpdateIndicator />);
    fireEvent.click(await findByLabelText("update available"));
    fireEvent.click(await findByLabelText("copy update command"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(UPGRADE_COMMAND));
  });

  it("opens the release notes page from the dialog", async () => {
    const { openReleasePage } = stubApp(updateAvailable);

    const { findByLabelText, findByText } = render(<UpdateIndicator />);
    fireEvent.click(await findByLabelText("update available"));
    fireEvent.click(await findByText(/release notes/i));

    expect(openReleasePage).toHaveBeenCalledOnce();
  });
});
