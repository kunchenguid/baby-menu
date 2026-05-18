export function installWidgetHostShims(target: Window, React: unknown, jsxRuntime: unknown) {
  target.__BABY_MENU_WIDGET_HOST__ = { React, jsxRuntime };
}
