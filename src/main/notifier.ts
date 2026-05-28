import { Notification } from "electron";
import type { BabyMenuNotification } from "../shared/contracts";

export type Notifier = (notification: BabyMenuNotification) => void;

// Backs `context.notify` for server actions and background tasks. Kept tiny and in its
// own module so the electron dependency stays out of the registry and scheduler.
export function createNotifier(): Notifier {
  return ({ title, body }) => {
    if (!title || !Notification.isSupported()) return;
    new Notification({ title, body }).show();
  };
}
