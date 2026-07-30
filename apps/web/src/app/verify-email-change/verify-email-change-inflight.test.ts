import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyEmailChangeOnce } from "./verify-email-change-inflight";

describe("verifyEmailChangeOnce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent POSTs for the same token (Strict Mode–safe)", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, email: "new@b.co" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = "z".repeat(43);
    const [a, b] = await Promise.all([verifyEmailChangeOnce(token), verifyEmailChangeOnce(token)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect((a.json as { email?: string }).email).toBe("new@b.co");
  });

  it("allows a second verification after the first promise settles (map entry cleared)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, email: "new@b.co" }), {
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
    await verifyEmailChangeOnce(token);
    await verifyEmailChangeOnce(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
