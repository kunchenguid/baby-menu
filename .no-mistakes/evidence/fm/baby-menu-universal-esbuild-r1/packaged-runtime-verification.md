# Packaged macOS runtime verification

## Why esbuild is not a runtime dependency

`esbuild` is a direct development dependency used by
`scripts/build-adapters.mjs` before packaging. It also enters electron-builder's
production dependency graph transitively through `acpx -> tsx -> esbuild`, but
that transitive path is unreachable in Baby Menu's runtime:

1. `acpx` publishes `.` as `dist/cli.js` and `./runtime` as
   `dist/runtime.js`. The `tsx/esm/api` reference is in the CLI-only
   `dist/cli-*.js` chunk. `dist/runtime.js` references neither `tsx` nor that
   CLI chunk.
2. `src/main/agent-runtime.ts` imports `acpx/runtime`, never the CLI entry.
3. Baby Menu does not shell out to the acpx CLI. Its `spawnSync` call only runs
   a `command -v` availability probe.
4. Agent adapters are built with `bundle: true` into
   `out/adapters/<agent>/index.mjs` before packaging and are spawned directly.
5. Runtime extension compilation imports the shipped `typescript` dependency,
   not esbuild.

`tests/acpx-runtime-dependencies.test.ts` locks the published acpx entry-point
boundary so a future acpx restructure that exposes `tsx` to the runtime fails
before packaging.

## Fixed package built from the reviewed change

Commands:

```text
pnpm package:mac
node scripts/e2e-packaged-mac-app.mjs "release/mac-universal/Baby Menu Dev.app"
```

Observed packaging result:

```text
Built ACP adapters: out/adapters/claude/index.mjs, out/adapters/codex/index.mjs
packaging platform=darwin arch=x64
packaging platform=darwin arch=arm64
packaging platform=darwin arch=universal
exit code: 0
```

The packaged-runtime harness inspected both `app.asar` and
`app.asar.unpacked` and found no `node_modules/esbuild` or
`node_modules/@esbuild` path. It then launched the universal app with isolated
state, loaded the real renderer and preload bridge, and completed a prompt
through the packaged app's externalized `acpx/runtime` against `acp-mock`:

```json
{"app":"release/mac-universal/Baby Menu Dev.app","rendererReady":true,"preloadReady":true,"agentRuntimeReady":true,"assistantText":"{\"summary\":\"packaged acpx runtime completed without esbuild\"}"}
```

The mock ACP event log contained `agent:prompt:done`. This exercises the lazy
agent runtime path that a renderer-only launch would miss and proves the
packaged app can invoke its embedded agent without esbuild.

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
by the Intel launch path:

```json
{"release":"baby-menu-v0.1.21","processArchitecture":"x86_64 via Rosetta","rendererReady":true,"preloadReady":true,"packagedEsbuild":"arm64-only and not executed"}
```
