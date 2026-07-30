import { afterEach, describe, expect, it, vi } from "vitest";
import { createImportLastfmPagePacer } from "./importPagePacing.js";

describe("createImportLastfmPagePacer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not sleep when minIntervalMs is 0", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onWait = vi.fn();
    const p = createImportLastfmPagePacer(
      { minIntervalMs: 0, burstPages: 1 },
      sleep,
      onWait,
    );
    await p.beforeNextPage();
    await p.beforeNextPage();
    await p.beforeNextPage();
    expect(sleep).not.toHaveBeenCalled();
    expect(onWait).not.toHaveBeenCalled();
  });

  it("allows burstPages fetches without sleeping, then sleeps before each subsequent page", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const p = createImportLastfmPagePacer({ minIntervalMs: 50, burstPages: 2 }, sleep);

    await p.beforeNextPage();
    p.afterPageCompleted();

    await p.beforeNextPage();
    p.afterPageCompleted();

    await p.beforeNextPage();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenLastCalledWith(50);

    p.afterPageCompleted();
    await p.beforeNextPage();
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("invokes onPacingWait before sleeping when configured", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onPacingWait = vi.fn();
    const p = createImportLastfmPagePacer(
      { minIntervalMs: 40, burstPages: 1 },
      sleep,
      onPacingWait,
    );

    await p.beforeNextPage();
    p.afterPageCompleted();
    await p.beforeNextPage();

    expect(onPacingWait).toHaveBeenCalledOnce();
    expect(onPacingWait).toHaveBeenCalledWith({
      waitedMs: 40,
      pagesCompleted: 1,
    });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("honors initialCompletedPages for resumed imports", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const p = createImportLastfmPagePacer(
      { minIntervalMs: 10, burstPages: 2 },
      sleep,
      undefined,
      2,
    );

    await p.beforeNextPage();
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
