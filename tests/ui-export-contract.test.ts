import { describe, expect, it } from "vitest";
import * as ui from "../src/ui";
import { UI_EXPORT_NAMES } from "../src/shared/ui-exports";

// The @babymenu/ui surface is a stability contract: the barrel, the contract
// list, and the host re-export shim must agree, or packaged widgets that import
// a name will silently get `undefined`. This test fails the moment they drift.
describe("@babymenu/ui public surface contract", () => {
  it("keeps the barrel exports exactly in sync with UI_EXPORT_NAMES", () => {
    const exported = Object.keys(ui).sort();
    const declared = [...UI_EXPORT_NAMES].sort();
    expect(exported).toEqual(declared);
  });
});
