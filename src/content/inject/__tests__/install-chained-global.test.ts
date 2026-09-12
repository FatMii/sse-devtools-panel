import { describe, expect, it } from "vitest";
import { installChainedGlobal } from "../install-chained-global";

describe("installChainedGlobal", () => {
  it("keeps our entry after reassignment to a bare downstream", () => {
    const host: { fn?: (n: number) => number } = {};
    const native = (n: number) => n;
    host.fn = native;

    let seen = 0;
    const { entry } = installChainedGlobal(host, "fn", native, ({ applyDownstream }) => {
      return (n: number) => {
        seen += 1;
        return applyDownstream(undefined, [n]) as number;
      };
    });

    expect(host.fn).toBe(entry);
    expect(host.fn!(3)).toBe(3);
    expect(seen).toBe(1);

    // Simulate another script replacing the implementation.
    host.fn = ((n: number) => n * 10) as typeof native;
    expect(host.fn).toBe(entry);
    expect(host.fn!(3)).toBe(30);
    expect(seen).toBe(2);
  });

  it("survives wrap-with-prev without infinite recursion", () => {
    const host: { fn?: (n: number) => number } = {};
    const native = (n: number) => n + 1;
    host.fn = native;

    let hooks = 0;
    const { entry } = installChainedGlobal(host, "fn", native, ({ applyDownstream }) => {
      return (n: number) => {
        hooks += 1;
        return applyDownstream(undefined, [n]) as number;
      };
    });

    const prev = host.fn!;
    host.fn = ((n: number) => prev(n) * 2) as typeof native;

    expect(host.fn).toBe(entry);
    // entry → theirWrap → entry (reentry→native(3)=4) → theirWrap returns 8
    expect(host.fn!(3)).toBe(8);
    expect(hooks).toBe(1);
  });

  it("ignores assigning the entry back onto itself", () => {
    const host: { fn?: (n: number) => number } = {};
    const native = (n: number) => n;
    host.fn = native;

    const { entry, getDownstream } = installChainedGlobal(
      host,
      "fn",
      native,
      ({ applyDownstream }) => {
        return (n: number) => applyDownstream(undefined, [n]) as number;
      },
    );

    host.fn = entry;
    expect(getDownstream()).toBe(native);
    expect(host.fn!(2)).toBe(2);
  });

  it("breaks ctor wrap-with-prev loops via native reentry", () => {
    class Native {
      value: number;
      constructor(value: number) {
        this.value = value;
      }
    }

    const host: { Ctor?: typeof Native } = { Ctor: Native };

    const { entry } = installChainedGlobal(host, "Ctor", Native, ({ constructDownstream }) => {
      function Patched(this: Native, value: number): Native {
        return constructDownstream([value]) as Native;
      }
      return Patched as unknown as typeof Native;
    });

    const Prev = host.Ctor!;
    host.Ctor = class Wrapped extends Native {
      constructor(value: number) {
        const inner = new Prev(value * 2);
        super(inner.value);
      }
    };

    expect(host.Ctor).toBe(entry);
    const instance = new (host.Ctor as typeof Native)(3);
    // Patched → Wrapped → Prev(=entry, reentry) → Native(6)
    expect(instance.value).toBe(6);
  });
});
