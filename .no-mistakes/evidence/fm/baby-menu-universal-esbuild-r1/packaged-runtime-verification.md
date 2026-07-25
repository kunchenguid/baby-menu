# Packaged macOS runtime verification

## Fixed package built from the reviewed change

Command:

```text
pnpm package:mac
```

Observed result:

```text
Built ACP adapters: out/adapters/claude/index.mjs, out/adapters/codex/index.mjs
packaging platform=darwin arch=x64
packaging platform=darwin arch=arm64
packaging platform=darwin arch=universal
exit code: 0
```

Package inspection:

```text
Baby Menu Dev: Mach-O universal binary with 2 architectures
  x86_64: Mach-O 64-bit executable x86_64
  arm64:  Mach-O 64-bit executable arm64

find Contents/Resources for node_modules/esbuild or node_modules/@esbuild:
  no matches

out/adapters/claude/index.mjs: present and non-empty
out/adapters/codex/index.mjs: present and non-empty
out/main/index.js: contains bundled AcpxOperationalError and runtime/session implementation
```

The repository's packaged-runtime harness launched the universal app from the
package, waited for its real Electron renderer, and probed the preload bridge:

```json
{"app":"release/mac-universal/Baby Menu Dev.app","rendererReady":true,"preloadReady":true}
```

## Public 0.1.21 comparison

The public `Baby-Menu-0.1.21-universal.dmg` was downloaded from GitHub Releases,
mounted read-only, and inspected:

```text
Contents/Resources/app.asar.unpacked/node_modules/esbuild/bin/esbuild:
  Mach-O 64-bit executable arm64

Contents/MacOS/Baby Menu:
  Mach-O universal binary with x86_64 and arm64

codesign --verify --deep --strict:
  valid on disk
  satisfies its Designated Requirement
```

The public 0.1.21 app was then explicitly launched under Rosetta as x86_64 with
an isolated user-data directory. Its real renderer and preload bridge both
initialized, proving the packaged arm64-only esbuild executable is not executed
by the Intel runtime path:

```json
{"release":"baby-menu-v0.1.21","processArchitecture":"x86_64 via Rosetta","rendererReady":true,"preloadReady":true,"packagedEsbuild":"arm64-only and not executed"}
```
