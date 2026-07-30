import { describe, expect, it } from "vitest";
import { rateLimitBucketForApiRequest } from "./middleware-rate-limit";

describe("rateLimitBucketForApiRequest", () => {
  it("maps outbound account email routes to email_outbound on POST", () => {
    expect(rateLimitBucketForApiRequest("/api/auth/setup", "POST")).toBe("email_outbound");
    expect(rateLimitBucketForApiRequest("/api/auth/recovery/request", "POST")).toBe(
      "email_outbound",
    );
    expect(rateLimitBucketForApiRequest("/api/me/resend-verification", "POST")).toBe(
      "email_outbound",
    );
    expect(rateLimitBucketForApiRequest("/api/me/email-change/request", "POST")).toBe(
      "email_outbound",
    );
  });

  it("keeps credential and token consumption routes on auth", () => {
    expect(rateLimitBucketForApiRequest("/api/auth/login", "POST")).toBe("auth");
    expect(rateLimitBucketForApiRequest("/api/auth/logout", "POST")).toBe("auth");
    expect(rateLimitBucketForApiRequest("/api/auth/recovery/confirm", "POST")).toBe("auth");
    expect(rateLimitBucketForApiRequest("/api/auth/verify-email", "POST")).toBe("auth");
    expect(rateLimitBucketForApiRequest("/api/auth/verify-email-change", "POST")).toBe("auth");
  });

  it("returns null for non-mutating methods on email routes", () => {
    expect(rateLimitBucketForApiRequest("/api/auth/setup", "GET")).toBeNull();
    expect(rateLimitBucketForApiRequest("/api/me/resend-verification", "GET")).toBeNull();
  });

  it("maps account deletion to destructive", () => {
    expect(rateLimitBucketForApiRequest("/api/me", "DELETE")).toBe("destructive");
    expect(rateLimitBucketForApiRequest("/api/me/listen-data", "POST")).toBe("destructive");
  });
});
