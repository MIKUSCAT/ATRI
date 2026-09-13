import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Ciphertext size after AES-128-ECB PKCS7 padding (always +1..16 bytes). */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

export function encryptAes128Ecb(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function decryptAes128Ecb(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function md5Hex(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

export function randomAesKey(): Buffer {
  return randomBytes(16);
}

export function randomFileKey(): string {
  return randomBytes(16).toString("hex");
}

/**
 * media.aes_key for outbound image items (openclaw / weixin-ilink style):
 * base64( ASCII hex string of 16 raw key bytes ) = base64(32-char hex).
 */
export function encodeAesKeyField(aesKey: Buffer): string {
  return Buffer.from(aesKey.toString("hex"), "utf8").toString("base64");
}

/**
 * Decode CDNMedia.aes_key which may be:
 * - base64(raw 16 bytes)
 * - base64(hex ASCII 32 chars)
 * - raw hex string (32 chars)
 */
export function parseAesKey(aesKeyField: string): Buffer {
  const raw = aesKeyField.trim();
  if (/^[0-9a-fA-F]{32}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32) {
    const asAscii = decoded.toString("ascii");
    if (/^[0-9a-fA-F]{32}$/.test(asAscii)) {
      return Buffer.from(asAscii, "hex");
    }
  }
  throw new Error(
    `aes_key must decode to 16 raw bytes or 32-char hex, got ${decoded.length} bytes`,
  );
}

export function buildCdnUploadUrl(
  cdnBaseUrl: string,
  uploadParam: string,
  filekey: string,
): string {
  const base = cdnBaseUrl.replace(/\/$/, "");
  return (
    `${base}/upload` +
    `?encrypted_query_param=${encodeURIComponent(uploadParam)}` +
    `&filekey=${encodeURIComponent(filekey)}`
  );
}

export function buildCdnDownloadUrl(
  cdnBaseUrl: string,
  encryptedQueryParam: string,
): string {
  const base = cdnBaseUrl.replace(/\/$/, "");
  return `${base}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}
