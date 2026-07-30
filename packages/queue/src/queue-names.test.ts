import { describe, expect, it } from "vitest";

import { VS_QUEUE_NAMES } from "./queue-names.js";

describe("VS_QUEUE_NAMES", () => {
  it("exposes stable smoke-test queue name", () => {
    expect(VS_QUEUE_NAMES.SMOKE_TEST).toBe("vs-smoke-test");
  });

  it("defines contract-backed domain queue names", () => {
    expect(VS_QUEUE_NAMES.IMPORTS).toBe("imports");
    expect(VS_QUEUE_NAMES.EXPORTS).toBe("exports");
    expect(VS_QUEUE_NAMES.ANALYTICS).toBe("analytics");
    expect(VS_QUEUE_NAMES.SYNC).toBe("sync");
    expect(VS_QUEUE_NAMES.INCREMENTAL_SYNC).toBe("incremental_sync");
  });
});
