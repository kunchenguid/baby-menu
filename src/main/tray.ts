import { Menu, nativeImage, Tray, type Rectangle } from "electron";

export type BabyMenuTray = {
  tray: Tray;
  getBounds: () => Rectangle;
};

export type BabyMenuTrayOptions = {
  iconPath: string;
  platform?: NodeJS.Platform;
};

export function createBabyMenuTray(onClick: (bounds: Rectangle) => void, options: BabyMenuTrayOptions): BabyMenuTray {
  const platform = options.platform ?? process.platform;
  const icon = nativeImage.createFromPath(options.iconPath);
  // setTemplateImage is a macOS no-op elsewhere, and StatusNotifierItem cannot
  // recolor a pixmap, so Linux uses the shipped colored icon as-is.
  if (platform === "darwin") icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip("baby-menu");
  tray.on("click", (_event, bounds) => onClick(bounds));

  // GNOME's AppIndicator extension always maps left click to the context menu,
  // so tray.on("click") never fires there and Linux needs a second entry point.
  // macOS must not get a context menu: it would hijack left click.
  if (platform === "linux") {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Baby Menu", click: () => onClick(tray.getBounds()) },
        { label: "Quit", role: "quit" },
      ]),
    );
  }

  return {
    tray,
    getBounds: () => tray.getBounds(),
  };
}
