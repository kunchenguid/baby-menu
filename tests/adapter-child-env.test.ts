import { describe, expect, it } from "vitest";
import { childEnv } from "../src/adapters/shared/child-env";

describe("childEnv", () => {
  it("strips ELECTRON_RUN_AS_NODE so the spawned CLI sees a normal env", () => {
    // baby-menu launches adapters via Electron-as-node; codex exec exits 1 if it
    // inherits ELECTRON_RUN_AS_NODE, so it must be removed from the child env.
    const env = childEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin", FOO: "bar" });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.FOO).toBe("bar");
  });

  it("also strips other Electron-internal markers", () => {
    const env = childEnv({ ELECTRON_NO_ATTACH_CONSOLE: "1", ELECTRON_NO_ASAR: "1", KEEP: "yes" });
    expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined();
    expect(env.ELECTRON_NO_ASAR).toBeUndefined();
    expect(env.KEEP).toBe("yes");
  });

  it("does not mutate the source env", () => {
    const source = { ELECTRON_RUN_AS_NODE: "1" };
    childEnv(source);
    expect(source.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
