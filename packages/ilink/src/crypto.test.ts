import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aesEcbPaddedSize,
  decryptAes128Ecb,
  encodeAesKeyField,
  encryptAes128Ecb,
  md5Hex,
  parseAesKey,
  randomAesKey,
} from "./crypto.js";

describe("ilink crypto", () => {
  it("round-trips AES-128-ECB PKCS7", () => {
    const key = randomAesKey();
    const plain = Buffer.from("hello wechat sticker 😊", "utf8");
    const cipher = encryptAes128Ecb(plain, key);
    assert.equal(cipher.length, aesEcbPaddedSize(plain.length));
    assert.deepEqual(decryptAes128Ecb(cipher, key), plain);
  });

  it("pads empty buffer to 16 bytes", () => {
    const key = randomAesKey();
    const cipher = encryptAes128Ecb(Buffer.alloc(0), key);
    assert.equal(cipher.length, 16);
    assert.deepEqual(decryptAes128Ecb(cipher, key), Buffer.alloc(0));
  });

  it("md5Hex is stable", () => {
    assert.equal(md5Hex(Buffer.from("abc")), "900150983cd24fb0d6963f7d28e17f72");
  });

  it("encode/parse aes_key field (base64 of hex ascii)", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const field = encodeAesKeyField(key);
    assert.deepEqual(parseAesKey(field), key);
  });

  it("parseAesKey accepts raw 16-byte base64", () => {
    const key = randomAesKey();
    const field = key.toString("base64");
    assert.deepEqual(parseAesKey(field), key);
  });

  it("parseAesKey accepts bare hex", () => {
    const hex = "00112233445566778899aabbccddeeff";
    assert.deepEqual(parseAesKey(hex), Buffer.from(hex, "hex"));
  });
});
