import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Stored ciphertext prefix so plaintext legacy rows can be detected on read. */
export const SECRET_BOX_V1_PREFIX = "enc:v1:" as const;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Parses a 32-byte AES key from base64, base64url, or hex.
 * Throws when the decoded length is not 32 bytes.
 */
export function parseSecretsEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("VS_SECRETS_ENCRYPTION_KEY is empty");
  }

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      key = Buffer.from(trimmed, "base64url");
    } catch {
      key = null;
    }
    if (!key || key.length !== KEY_BYTES) {
      try {
        key = Buffer.from(trimmed, "base64");
      } catch {
        key = null;
      }
    }
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "VS_SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64, base64url, or hex)",
    );
  }
  return key;
}

export function isEncryptedSecretBlob(value: string): boolean {
  return value.startsWith(SECRET_BOX_V1_PREFIX);
}

/**
 * AES-256-GCM encrypt. Output: `enc:v1:` + base64url(iv || ciphertext || tag).
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("encryptSecret: key must be 32 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    SECRET_BOX_V1_PREFIX +
    Buffer.concat([iv, ciphertext, tag]).toString("base64url")
  );
}

/**
 * Decrypts `enc:v1:` blobs. Returns non-prefixed values unchanged (legacy plaintext).
 */
export function decryptSecret(stored: string, key: Buffer): string {
  if (!isEncryptedSecretBlob(stored)) {
    return stored;
  }
  if (key.length !== KEY_BYTES) {
    throw new Error("decryptSecret: key must be 32 bytes");
  }
  const packed = Buffer.from(stored.slice(SECRET_BOX_V1_PREFIX.length), "base64url");
  if (packed.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("decryptSecret: ciphertext too short");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(packed.length - TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES, packed.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/** Constant-time equality for comparing derived keys in tests / health checks. */
export function secretsKeysEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
