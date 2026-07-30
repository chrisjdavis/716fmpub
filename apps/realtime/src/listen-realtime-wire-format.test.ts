import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildListensUpdatedFrame, buildReadyFrame } from "./listen-realtime-wire-format.js";

describe("listen realtime wire format", () => {
  it("ready frame is minimal JSON", () => {
    expect(buildReadyFrame()).toBe('{"type":"ready"}');
  });

  it("listens_updated stays small and matches consumer expectations", () => {
    const id = randomUUID();
    const raw = buildListensUpdatedFrame(id);
    expect(raw.length).toBeLessThan(200);
    const o = JSON.parse(raw) as { type: string; vs_event_id: string };
    expect(o.type).toBe("listens_updated");
    expect(o.vs_event_id).toBe(id);
  });
});
