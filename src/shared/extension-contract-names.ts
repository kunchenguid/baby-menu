// The public, extension-facing slice of the Baby Menu contract surface.
//
// Extensions cannot see src/shared/contracts.ts (it lives inside the app bundle,
// not in the extension workspace), so the host ships these types into the
// workspace as the `@babymenu/contracts` virtual module declared in
// extensions/babymenu-env.d.ts. This list is the single source of truth for
// which names that module exposes: tests/extension-contract-surface.test.ts
// fails the moment the declaration file or contracts.ts drifts from it, the same
// way UI_EXPORT_NAMES guards the @babymenu/ui surface.
//
// Every name here must be an exported type in src/shared/contracts.ts. Keep the
// host-only surfaces (git, agent, settings, app, recipes, widget loading) out.
export const EXTENSION_CONTRACT_NAMES = [
  // Widget and settings descriptors exported from widget.tsx.
  "BabyMenuWidget",
  "RefreshableBabyMenuWidget",
  "BabyMenuSettingsSection",
  // Root layout.tsx surface: the canvas component and the props the host passes it.
  "BabyMenuLayout",
  "BabyMenuLayoutProps",
  "BabyMenuLayoutWidget",
  // server.ts surface: the action/background context and what it carries.
  "BabyMenuServerContext",
  "BabyMenuDatabase",
  "BabyMenuNotification",
  "BabyMenuBackgroundTask",
  "SqlParams",
  "SqlRunResult",
  // Bridge data shapes widgets receive over window.babyMenu.
  "BabyMenuCapabilityDescriptor",
  "BackgroundTaskUpdate",
  "PopoverVisibilityState",
  // The window.babyMenu subset widgets call.
  "BabyMenuExtensionApi",
] as const;

export type ExtensionContractName = (typeof EXTENSION_CONTRACT_NAMES)[number];
