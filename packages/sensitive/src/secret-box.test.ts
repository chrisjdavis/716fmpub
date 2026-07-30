import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretBlob,
  parseSecretsEncryptionKey,
  SECRET_BOX_V1_PREFIX,
} from "./secret-box.js";

describe("secret-box", () => {
  const key = parseSecretsEncryptionKey(
    Buffer.alloc(32, 7).toString("base64url"),
  );

  it("round-trips plaintext", () => {
    const blob = encryptSecret("lastfm-secret-key", key);
    expect(blob.startsWith(SECRET_BOX_V1_PREFIX)).toBe(true);
    expect(isEncryptedSecretBlob(blob)).toBe(true);
    expect(decryptSecret(blob, key)).toBe("lastfm-secret-key");
  });

  it("returns legacy plaintext unchanged", () => {
    expect(decryptSecret("plain-key", key)).toBe("plain-key");
  });

  it("rejects wrong key length on parse", () => {
    expect(() => parseSecretsEncryptionKey("too-short")).toThrow(/32 bytes/);
  });

  it("accepts hex keys", () => {
    const hex = "ab".repeat(32);
    const k = parseSecretsEncryptionKey(hex);
    expect(k.length).toBe(32);
    expect(decryptSecret(encryptSecret("x", k), k)).toBe("x");
  });
});
