import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyEmailOnce } from "./verify-email-inflight";

describe("verifyEmailOnce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent POSTs for the same token (Strict Mode–safe)", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, email: "a@b.co", newlyVerified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = "z".repeat(43);
    const [a, b] = await Promise.all([verifyEmailOnce(token), verifyEmailOnce(token)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect((a.json as { email?: string }).email).toBe("a@b.co");
  });

  it("allows a second verification after the first promise settles (map entry cleared)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, email: "a@b.co", newlyVerified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, code: "replayed", error: "used" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const token = "y".repeat(43);
    await verifyEmailOnce(token);
    await verifyEmailOnce(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
