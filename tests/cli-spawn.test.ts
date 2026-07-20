import { describe, expect, it, vi } from "vitest";
import { spawnAgentCli } from "../src/adapters/shared/cli-spawn";
import { resolveWslExecutable } from "../src/shared/wsl-agent";

type SpawnCall = [string, string[], { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: unknown; windowsHide?: boolean }];

describe("spawnAgentCli", () => {
  it("spawns the CLI directly on host with the given cwd", () => {
    const spawnImpl = vi.fn((_cmd: string, _args: readonly string[], _opts: object) => ({ pid: 1 }) as never);
    spawnAgentCli("claude", ["-p", "hi"], {
      cwd: "/tmp/workspace",
      env: { PATH: "/usr/bin", BABY_MENU_AGENT_RUNTIME: "host" },
      spawnImpl: spawnImpl as never,
    });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnImpl.mock.calls[0] as SpawnCall;
    expect(command).toBe("claude");
    expect(args).toEqual(["-p", "hi"]);
    expect(opts.cwd).toBe("/tmp/workspace");
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(opts.windowsHide).toBe(true);
    expect(opts.env?.BABY_MENU_AGENT_RUNTIME).toBe("host");
    expect(opts.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("routes through wsl with cd and clears Node cwd when runtime is wsl", () => {
    const spawnImpl = vi.fn((_cmd: string, _args: readonly string[], _opts: object) => ({ pid: 1 }) as never);
    spawnAgentCli("codex", ["exec", "hello"], {
      cwd: String.raw`C:\Users\me\.baby-menu\extensions`,
      env: {
        PATH: "C:\\Windows",
        BABY_MENU_AGENT_RUNTIME: "wsl",
        BABY_MENU_WSL_DISTRO: "Debian",
        ELECTRON_RUN_AS_NODE: "1",
      },
      spawnImpl: spawnImpl as never,
    });

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnImpl.mock.calls[0] as SpawnCall;
    expect(command).toBe(resolveWslExecutable());
    expect(args).toEqual(expect.arrayContaining(["-d", "Debian", "--", "bash", "-lc"]));
    expect(opts.cwd).toBeUndefined();
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    const script = args[args.length - 1]!;
    expect(script).toContain("cd '/mnt/c/Users/me/.baby-menu/extensions'");
    expect(script).toContain("'codex'");
    expect(script).toContain("'exec'");
    expect(script).toContain("'hello'");
    expect(opts.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("defaults distro to Ubuntu when BABY_MENU_WSL_DISTRO is unset", () => {
    const spawnImpl = vi.fn((_cmd: string, _args: readonly string[], _opts: object) => ({ pid: 1 }) as never);
    spawnAgentCli("claude", [], {
      cwd: String.raw`C:\work`,
      env: { BABY_MENU_AGENT_RUNTIME: "wsl" },
      spawnImpl: spawnImpl as never,
    });
    const [, args] = spawnImpl.mock.calls[0] as SpawnCall;
    expect(args).toEqual(expect.arrayContaining(["-d", "Ubuntu"]));
  });

  it("refuses an invalid WSL distro from env without spawning", () => {
    const spawnImpl = vi.fn((_cmd: string, _args: readonly string[], _opts: object) => ({ pid: 1 }) as never);
    expect(() =>
      spawnAgentCli("claude", [], {
        cwd: String.raw`C:\work`,
        env: {
          BABY_MENU_AGENT_RUNTIME: "wsl",
          BABY_MENU_WSL_DISTRO: 'Ubuntu"; evil',
        },
        spawnImpl: spawnImpl as never,
      }),
    ).toThrow(/distro/i);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
