import { beforeEach, describe, expect, it, vi } from "vitest";

const show = vi.fn();
const NotificationMock = vi.fn(function NotificationMock() {
  return { show };
});
const isSupported = vi.fn(() => true);
(NotificationMock as unknown as { isSupported: typeof isSupported }).isSupported = isSupported;

vi.mock("electron", () => ({ Notification: NotificationMock }));

describe("notifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupported.mockReturnValue(true);
  });

  it("shows a native notification with title and body", async () => {
    const { createNotifier } = await import("../src/main/notifier");
    createNotifier()({ title: "CPU high", body: "95%" });

    expect(NotificationMock).toHaveBeenCalledWith({ title: "CPU high", body: "95%" });
    expect(show).toHaveBeenCalledOnce();
  });

  it("does nothing without a title or when notifications are unsupported", async () => {
    const { createNotifier } = await import("../src/main/notifier");
    const notify = createNotifier();

    notify({ title: "" });
    isSupported.mockReturnValue(false);
    notify({ title: "ignored" });

    expect(NotificationMock).not.toHaveBeenCalled();
  });
});
