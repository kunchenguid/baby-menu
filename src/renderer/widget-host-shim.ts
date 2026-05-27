export function installWidgetHostShims(target: Window, React: unknown, jsxRuntime: unknown, ui: unknown) {
  target.__BABY_MENU_WIDGET_HOST__ = { React, jsxRuntime, ui };
}
