import { describe, expect, it } from "vitest";
import { pathnameAcceptsListenCoalescedRefresh } from "./listen-refresh-pathname";

describe("pathnameAcceptsListenCoalescedRefresh", () => {
  it("allows home and explore stats", () => {
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard")).toBe(true);
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/explore")).toBe(true);
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/explore/extra")).toBe(true);
  });

  it("allows archive and imports", () => {
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/archive")).toBe(true);
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/imports")).toBe(true);
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/imports/anything")).toBe(true);
  });

  it("denies export and settings", () => {
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/export")).toBe(false);
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/settings")).toBe(false);
  });

  it("denies unknown dashboard paths", () => {
    expect(pathnameAcceptsListenCoalescedRefresh("/dashboard/unknown")).toBe(false);
  });
});
