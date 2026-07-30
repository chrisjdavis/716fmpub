import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/** Legacy scrypt hashes (pre–Argon2id); still verified for existing accounts. */
const LEGACY_SCRYPT_PREFIX = "scrypt$v1$" as const;

const LEGACY_SALT_BYTES = 16;
const LEGACY_KEY_BYTES = 64;

const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_BYTES = 16;

function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      },
      (err, derived) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derived);
      },
    );
  });
}

function verifyLegacyScrypt(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(LEGACY_SCRYPT_PREFIX)) {
    return Promise.resolve(false);
  }
  const rest = stored.slice(LEGACY_SCRYPT_PREFIX.length);
  const dollar = rest.indexOf("$");
  if (dollar <= 0) {
    return Promise.resolve(false);
  }
  const saltHex = rest.slice(0, dollar);
  const expectedHex = rest.slice(dollar + 1);
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return Promise.resolve(false);
  }
  if (salt.length !== LEGACY_SALT_BYTES || expected.length !== LEGACY_KEY_BYTES) {
    return Promise.resolve(false);
  }
  return scryptDerive(plain, salt, LEGACY_KEY_BYTES)
    .then((derived) => timingSafeEqual(derived, expected))
    .catch(() => false);
}

/**
 * Argon2id (PHC encoded string). Legacy `scrypt$v1$…` hashes are still accepted by {@link verifyPassword}.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(ARGON2_SALT_BYTES);
  return argon2id({
    password: plain,
    salt,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "encoded",
  });
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("$argon2id$")) {
    try {
      return await argon2Verify({ password: plain, hash: stored });
    } catch {
      return false;
    }
  }
  if (stored.startsWith(LEGACY_SCRYPT_PREFIX)) {
    return verifyLegacyScrypt(plain, stored);
  }
  return false;
}
