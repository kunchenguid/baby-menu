import { nativeImage, Tray, type Rectangle } from "electron";

export type BabyMenuTray = {
  tray: Tray;
  getBounds: () => Rectangle;
};

export type BabyMenuTrayOptions = {
  iconPath: string;
  /** Override platform so darwin-only template behavior can be unit-tested on Linux. */
  platform?: NodeJS.Platform;
};

export function createBabyMenuTray(onClick: (bounds: Rectangle) => void, options: BabyMenuTrayOptions): BabyMenuTray {
  const icon = nativeImage.createFromPath(options.iconPath);
  const platform = options.platform ?? process.platform;
  // Template images are a macOS menu-bar concept; on Windows they often render blank.
  if (platform === "darwin") {
    icon.setTemplateImage(true);
  }

  const tray = new Tray(icon);
  tray.setToolTip("baby-menu");
  tray.on("click", (_event, bounds) => onClick(bounds));

  return {
    tray,
    getBounds: () => tray.getBounds(),
  };
}
