import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMediaRefs,
  isAllowedMediaUrl,
  isVisionMime,
  mediaKindLabel,
  sniffMediaMime,
} from "./media.js";
import type { WeixinMessage } from "./types.js";

function bytes(...b: number[]): Buffer {
  return Buffer.from(b);
}

function withAscii(text: string, pad = 0): Buffer {
  const head = Buffer.alloc(pad);
  return Buffer.concat([head, Buffer.from(text, "latin1")]);
}

describe("sniffMediaMime", () => {
  it("identifies images", () => {
    assert.equal(
      sniffMediaMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
      "image/png",
    );
    assert.equal(sniffMediaMime(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
    assert.equal(sniffMediaMime(withAscii("GIF89a....")), "image/gif");
    assert.equal(
      sniffMediaMime(Buffer.concat([Buffer.from("RIFF____WEBPVP8 ")])),
      "image/webp",
    );
    assert.equal(sniffMediaMime(withAscii("BM______")), "image/bmp");
  });

  it("identifies WeChat voice containers", () => {
    // Bare SILK tag and the variant with one leading byte both appear in the wild
    assert.equal(sniffMediaMime(withAscii("#!SILK_V3")), "audio/silk");
    assert.equal(sniffMediaMime(withAscii("#!SILK_V3", 1)), "audio/silk");
    assert.equal(sniffMediaMime(withAscii("#!AMR\n")), "audio/amr");
  });

  it("splits ISO-BMFF into audio vs video by brand", () => {
    assert.equal(
      sniffMediaMime(Buffer.from("____ftypM4A ", "latin1")),
      "audio/mp4",
    );
    assert.equal(
      sniffMediaMime(Buffer.from("____ftypisom", "latin1")),
      "video/mp4",
    );
  });

  it("distinguishes RIFF/WAVE from RIFF/WEBP", () => {
    assert.equal(
      sniffMediaMime(Buffer.from("RIFF____WAVEfmt ", "latin1")),
      "audio/wav",
    );
  });

  it("returns null for unknown or too-short buffers", () => {
    assert.equal(sniffMediaMime(Buffer.alloc(0)), null);
    assert.equal(sniffMediaMime(bytes(1, 2)), null);
    assert.equal(sniffMediaMime(Buffer.from("not media at all")), null);
  });
});

describe("isVisionMime", () => {
  it("accepts only what an OpenAI-compatible image_url can carry", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      assert.equal(isVisionMime(m), true, m);
    }
    for (const m of ["image/bmp", "audio/silk", "video/mp4", null, undefined]) {
      assert.equal(isVisionMime(m), false, String(m));
    }
  });
});

describe("extractMediaRefs", () => {
  it("returns nothing for text-only messages", () => {
    const msg: WeixinMessage = {
      item_list: [{ type: 1, text_item: { text: "你好" } }],
    };
    assert.deepEqual(extractMediaRefs(msg), []);
  });

  it("reads image CDN coordinates", () => {
    const msg: WeixinMessage = {
      item_list: [
        {
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: "eqp-1",
              aes_key: "a".repeat(32),
              encrypt_type: 1,
            },
            mid_size: 4096,
          },
        },
      ],
    };
    const refs = extractMediaRefs(msg);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.kind, "image");
    assert.equal(refs[0]!.index, 0);
    assert.equal(refs[0]!.encryptQueryParam, "eqp-1");
    assert.equal(refs[0]!.aesKey, "a".repeat(32));
    assert.equal(refs[0]!.encryptType, 1);
    assert.equal(refs[0]!.cipherSize, 4096);
  });

  it("falls back to item-level aeskey and url", () => {
    const msg: WeixinMessage = {
      item_list: [
        {
          type: 2,
          image_item: {
            aeskey: "b".repeat(32),
            url: "https://cdn.example/img",
          },
        },
      ],
    };
    const refs = extractMediaRefs(msg);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.aesKey, "b".repeat(32));
    assert.equal(refs[0]!.fullUrl, "https://cdn.example/img");
  });

  it("carries the iLink voice transcript through", () => {
    const msg: WeixinMessage = {
      item_list: [
        {
          type: 3,
          voice_item: {
            media: { encrypt_query_param: "eqp-v" },
            voice_text: "  语音转写  ",
          },
        },
      ],
    };
    const refs = extractMediaRefs(msg);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.kind, "voice");
    assert.equal(refs[0]!.transcript, "语音转写");
  });

  it("skips media-less items", () => {
    const msg: WeixinMessage = {
      item_list: [{ type: 2, image_item: {} }],
    };
    assert.deepEqual(extractMediaRefs(msg), []);
  });

  it("probes sub-objects when the item type number is unexpected", () => {
    // Item types 4/5 are inferred; a mis-numbered item that plainly carries a
    // file_item must still be picked up rather than dropped on the number.
    const msg: WeixinMessage = {
      item_list: [
        {
          type: 9 as never,
          file_item: {
            media: { encrypt_query_param: "eqp-f" },
            file_name: "report.pdf",
          },
        },
      ],
    };
    const refs = extractMediaRefs(msg);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.kind, "file");
    assert.equal(refs[0]!.fileName, "report.pdf");
  });

  it("keeps item order and index across a mixed message", () => {
    const msg: WeixinMessage = {
      item_list: [
        { type: 1, text_item: { text: "看这个" } },
        { type: 2, image_item: { media: { encrypt_query_param: "a" } } },
        { type: 2, image_item: { media: { encrypt_query_param: "b" } } },
      ],
    };
    const refs = extractMediaRefs(msg);
    assert.deepEqual(
      refs.map((r) => [r.index, r.encryptQueryParam]),
      [
        [1, "a"],
        [2, "b"],
      ],
    );
  });
});

describe("isAllowedMediaUrl", () => {
  const CDN = "https://novac2c.cdn.weixin.qq.com/c2c";

  it("allows the configured CDN base host", () => {
    assert.equal(
      isAllowedMediaUrl("https://novac2c.cdn.weixin.qq.com/c2c/download?x=1", {
        cdnBaseUrl: CDN,
      }),
      true,
    );
  });

  it("allows other WeChat / QQ CDN subdomains", () => {
    for (const u of [
      "https://mmbiz.qpic.weixin.qq.com/a.jpg",
      "https://wx.qq.com/x",
      "https://other.cdn.weixin.qq.com/y",
    ]) {
      assert.equal(isAllowedMediaUrl(u, { cdnBaseUrl: CDN }), true, u);
    }
  });

  it("rejects an arbitrary external host", () => {
    assert.equal(
      isAllowedMediaUrl("https://evil.example/payload.png", { cdnBaseUrl: CDN }),
      false,
    );
  });

  it("rejects loopback, private ranges and cloud metadata", () => {
    // These are the SSRF targets that matter on a box that also talks to Redis.
    for (const host of [
      "127.0.0.1",
      "localhost",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "metadata.google.internal",
      "redis.local",
      "[::1]",
    ]) {
      assert.equal(
        isAllowedMediaUrl(`http://${host}/x`, { cdnBaseUrl: CDN }),
        false,
        host,
      );
    }
  });

  it("still allows public 172.x outside the private block", () => {
    assert.equal(
      isAllowedMediaUrl("http://172.32.0.1/x", {
        cdnBaseUrl: CDN,
        extraHosts: ["172.32.0.1"],
      }),
      true,
    );
    assert.equal(
      isAllowedMediaUrl("http://172.15.0.1/x", { extraHosts: ["172.15.0.1"] }),
      true,
    );
  });

  it("rejects non-http schemes and embedded credentials", () => {
    for (const u of [
      "file:///etc/passwd",
      "gopher://novac2c.cdn.weixin.qq.com/x",
      "data:image/png;base64,AAAA",
      "https://user:pass@novac2c.cdn.weixin.qq.com/x",
    ]) {
      assert.equal(isAllowedMediaUrl(u, { cdnBaseUrl: CDN }), false, u);
    }
  });

  it("rejects unparseable input", () => {
    assert.equal(isAllowedMediaUrl("not a url", { cdnBaseUrl: CDN }), false);
    assert.equal(isAllowedMediaUrl("", { cdnBaseUrl: CDN }), false);
  });

  it("honours an explicit extra host", () => {
    assert.equal(
      isAllowedMediaUrl("https://my-mirror.test/x", {
        cdnBaseUrl: CDN,
        extraHosts: [" My-Mirror.test "],
      }),
      true,
    );
  });

  it("survives a malformed configured base", () => {
    assert.equal(
      isAllowedMediaUrl("https://x.weixin.qq.com/a", { cdnBaseUrl: "::::" }),
      true,
    );
    assert.equal(
      isAllowedMediaUrl("https://evil.example/a", { cdnBaseUrl: "::::" }),
      false,
    );
  });
});

describe("mediaKindLabel", () => {
  it("labels every kind", () => {
    assert.equal(mediaKindLabel("image"), "图片");
    assert.equal(mediaKindLabel("voice"), "语音");
    assert.equal(mediaKindLabel("video"), "视频");
    assert.equal(mediaKindLabel("file"), "文件");
  });
});
