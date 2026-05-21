import { nativeImage, Tray, type Rectangle } from "electron";

export type BabyMenuTray = {
  tray: Tray;
  getBounds: () => Rectangle;
};

export type BabyMenuTrayOptions = {
  iconPath: string;
};

export function createBabyMenuTray(onClick: (bounds: Rectangle) => void, options: BabyMenuTrayOptions): BabyMenuTray {
  const icon = nativeImage.createFromPath(options.iconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip("baby-menu");
  tray.on("click", (_event, bounds) => onClick(bounds));

  return {
    tray,
    getBounds: () => tray.getBounds(),
  };
}
