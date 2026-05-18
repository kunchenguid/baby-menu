import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const WIDGET_SCHEME = "baby-menu-widget";
const HOST_SCHEME = "baby-menu-host";

export function registerBabyMenuProtocolSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WIDGET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: HOST_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function registerBabyMenuProtocolHandlers(options: { widgetCacheDir: string }) {
  protocol.handle(WIDGET_SCHEME, async (request) => {
    const filePath = resolveWidgetProtocolFilePath(options.widgetCacheDir, request.url);
    const source = await readFile(filePath, "utf8");
    return new Response(source, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  });

  protocol.handle(HOST_SCHEME, async (request) => {
    return new Response(hostProtocolModuleSource(request.url), {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  });
}

export function resolveWidgetProtocolFilePath(widgetCacheDir: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== `${WIDGET_SCHEME}:`) throw new Error("Invalid widget module URL");
  const extensionId = decodeURIComponent(url.hostname);
  const pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!extensionId || pathSegments.length < 2 || pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid widget module URL");
  }
  if (!pathSegments.at(-1)?.endsWith(".mjs")) throw new Error("Invalid widget module URL");

  const filePath = resolve(join(widgetCacheDir, extensionId, ...pathSegments));
  const relativePath = relative(resolve(widgetCacheDir), filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("Invalid widget module URL");
  return filePath;
}

export function hostProtocolModuleSource(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== `${HOST_SCHEME}:`) throw new Error("Unknown host module URL");
  const moduleId = `${url.hostname}${url.pathname}`;

  if (moduleId === "react/index.mjs") {
    return `const React = window.__BABY_MENU_WIDGET_HOST__.React;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cache = React.cache;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useEffectEvent = React.useEffectEvent;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useRef = React.useRef;
export const useMemo = React.useMemo;
export const useReducer = React.useReducer;
export const useLayoutEffect = React.useLayoutEffect;
export const useOptimistic = React.useOptimistic;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
export default React;
`;
  }

  if (moduleId === "react-jsx-runtime/index.mjs") {
    return `const runtime = window.__BABY_MENU_WIDGET_HOST__.jsxRuntime;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const Fragment = runtime.Fragment;
`;
  }

  throw new Error("Unknown host module URL");
}
