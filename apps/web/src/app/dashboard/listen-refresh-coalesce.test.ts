import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createListenRefreshCoalescer } from "./listen-refresh-coalesce";

describe("createListenRefreshCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes once after trailing debounce for a burst", () => {
    const flush = vi.fn();
    const c = createListenRefreshCoalescer(
      { trailingDebounceMs: 200, maxWaitMs: 10_000 },
      flush,
    );
    c.request();
    c.request();
    c.request();
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0]).toEqual({
      signalCount: 3,
      flushReason: "trailing_debounce",
    });
    c.dispose();
  });

  it("forces a flush on maxWait while signals keep arriving", () => {
    const flush = vi.fn();
    const c = createListenRefreshCoalescer(
      { trailingDebounceMs: 500, maxWaitMs: 300 },
      flush,
    );
    c.request();
    vi.advanceTimersByTime(100);
    c.request();
    vi.advanceTimersByTime(100);
    c.request();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].flushReason).toBe("max_wait");
    expect(flush.mock.calls[0][0].signalCount).toBe(3);
    c.dispose();
  });

  it("dispose clears timers without flushing", () => {
    const flush = vi.fn();
    const c = createListenRefreshCoalescer(
      { trailingDebounceMs: 200, maxWaitMs: 10_000 },
      flush,
    );
    c.request();
    c.dispose();
    vi.runAllTimers();
    expect(flush).not.toHaveBeenCalled();
  });

  it("starts a new burst after a flush", () => {
    const flush = vi.fn();
    const c = createListenRefreshCoalescer(
      { trailingDebounceMs: 100, maxWaitMs: 10_000 },
      flush,
    );
    c.request();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    c.request();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(2);
    c.dispose();
  });
});
