import type { MailgunOutboundConfig } from "@vs/env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailgunMailer, MailgunTransportError } from "./mailgun-mailer.js";

const sampleConfig: MailgunOutboundConfig = {
  apiKey: "k".repeat(32),
  domain: "mg.example.com",
  from: "716FM <noreply@mg.example.com>",
  region: "us",
  messagesUrl: "https://api.mailgun.net/v3/mg.example.com/messages",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MailgunMailer", () => {
  it("POSTs multipart form fields and Authorization to the configured messages URL", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toBeDefined();
        const headers = new Headers(init?.headers as HeadersInit);
        expect(headers.get("Authorization")).toBe(
          `Basic ${Buffer.from(`api:${sampleConfig.apiKey}`, "utf8").toString("base64")}`,
        );
        expect(init?.body).toBeInstanceOf(FormData);
        const body = init?.body as FormData;
        expect(body.get("from")).toBe(sampleConfig.from);
        expect(body.get("to")).toBe("ops@example.com");
        expect(body.get("subject")).toBe("Smoke");
        expect(body.get("text")).toBe("hello");
        return new Response(JSON.stringify({ id: "<provider-id>", message: "Queued" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const mailer = new MailgunMailer(sampleConfig);
    const result = await mailer.sendEmail({
      to: "ops@example.com",
      subject: "Smoke",
      text: "hello",
    });

    expect(result.providerMessageId).toBe("<provider-id>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(sampleConfig.messagesUrl);
  });

  it("includes html when provided", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = init?.body as FormData;
      expect(body.get("html")).toBe("<p>hi</p>");
      return new Response(JSON.stringify({ id: "id-2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const mailer = new MailgunMailer(sampleConfig);
    await mailer.sendEmail({
      to: "ops@example.com",
      subject: "h",
      text: "t",
      html: "<p>hi</p>",
    });
  });

  it("throws MailgunTransportError on Mailgun HTTP error responses without echoing the API key", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response("forbidden", { status: 401, statusText: "Unauthorized" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const mailer = new MailgunMailer(sampleConfig);
    const err = await mailer.sendEmail({ to: "x@y.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailgunTransportError);
    expect((err as MailgunTransportError).httpStatus).toBe(401);
    expect(String(err)).not.toContain(sampleConfig.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts key-like fragments in Mailgun error response hints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        return new Response('{"message":"bad key=supersecret"}', { status: 400 });
      }),
    );

    const mailer = new MailgunMailer(sampleConfig);
    const err = await mailer.sendEmail({ to: "x@y.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailgunTransportError);
    expect((err as MailgunTransportError).responseHint).toContain("<redacted>");
    expect((err as MailgunTransportError).responseHint).not.toContain("supersecret");
  });

  it("retries transient 5xx responses then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "after-retry" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const mailer = new MailgunMailer(sampleConfig, { retryBackoffMs: [0, 0] });
    const result = await mailer.sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(result.providerMessageId).toBe("after-retry");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after configured attempts on persistent 503", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const mailer = new MailgunMailer(sampleConfig, { retryBackoffMs: [0, 0] });
    const err = await mailer.sendEmail({ to: "x@y.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailgunTransportError);
    expect((err as MailgunTransportError).httpStatus).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws MailgunTransportError when success JSON omits id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    const mailer = new MailgunMailer(sampleConfig);
    await expect(mailer.sendEmail({ to: "x@y.com", subject: "s", text: "t" })).rejects.toMatchObject({
      name: "MailgunTransportError",
      httpStatus: 200,
    });
  });
});
