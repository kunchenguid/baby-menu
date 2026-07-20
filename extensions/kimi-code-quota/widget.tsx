import type { RefreshableBabyMenuWidget } from "@babymenu/contracts";
import { KimiQuotaView } from "./components";
import { refreshKimiQuotaView } from "./store";

export const kimiCodeQuotaWidget: RefreshableBabyMenuWidget = {
  id: "kimi-code-quota",
  title: "KIMI CODE",
  refreshView: refreshKimiQuotaView,
  render: () => <KimiQuotaView />,
};
