import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ILinkClient } from "./client.js";
import { encryptAes128Ecb, parseAesKey } from "./crypto.js";
import { ITEM_TYPE, UPLOAD_MEDIA_TYPE } from "./types.js";
import type { InboundMediaRef } from "./types.js";

interface Call {
  url: string;
  path: string;
  body: Record<string, unknown> | null;
  raw: Uint8Array | null;
}

let restoreFetch: (() => void) | null = null;

/**
 * Mocks the three hops a media send makes: getuploadurl (JSON), the CDN upload
 * (octet-stream, answers with x-encrypted-param), and sendmessage (JSON).
 */
function installFetch(
  opts: {
    cdnDownload?: { body: Buffer; headers?: Record<string, string> };
  } = {},
): Call[] {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
    restoreFetch = null;
  };

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const isJson = typeof init?.body === "string";
    calls.push({
      url,
      path,
      body: isJson
        ? (JSON.parse(String(init!.body)) as Record<string, unknown>)
        : null,
      raw: isJson ? null : ((init?.body as Uint8Array) ?? null),
    });

    if (path.endsWith("/getuploadurl")) {
      return json({ ret: 0, upload_full_url: "https://cdn.test/c2c/upload?x=1" });
    }
    if (path.endsWith("/upload")) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "x-encrypted-param": "dl-param-1" }),
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    }
    if (path.endsWith("/download")) {
      const d = opts.cdnDownload;
      if (!d) return json({ ret: 0 });
      return {
        ok: true,
        status: 200,
        headers: new Headers(d.headers ?? {}),
        body: bufferToStream(d.body),
        arrayBuffer: async () => d.body,
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    }
    return json({ ret: 0 });
  }) as typeof globalThis.fetch;

  return calls;
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function bufferToStream(buf: Buffer): ReadableStream<Uint8Array> {
  // Two chunks, so the running byte cap is exercised mid-stream.
  const mid = Math.max(1, Math.floor(buf.length / 2));
  const parts = [buf.subarray(0, mid), buf.subarray(mid)];
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(parts[i]!));
      i++;
    },
  });
}

function client(overrides: Record<string, unknown> = {}): ILinkClient {
  return new ILinkClient({
    botToken: "tok",
    baseUrl: "https://ilink.test",
    cdnBaseUrl: "https://cdn.test/c2c",
    ...overrides,
  });
}

function sentItem(calls: Call[]): Record<string, unknown> {
  const send = calls.find((c) => c.path.endsWith("/sendmessage"));
  assert.ok(send, "sendmessage was not called");
  const msg = send.body!.msg as { item_list: Array<Record<string, unknown>> };
  return msg.item_list[0]!;
}

const peer = { toUserId: "peer-1", contextToken: "ctx-1" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

afterEach(() => {
  restoreFetch?.();
});

describe("sendVoice", () => {
  it("uploads with media_type 4 and emits a voice_item", async () => {
    const calls = installFetch();
    await client().sendVoice({
      ...peer,
      voice: Buffer.from("#!SILK_V3 audio"),
      durationMs: 2500,
    });

    const upload = calls.find((c) => c.path.endsWith("/getuploadurl"))!;
    assert.equal(upload.body!.media_type, UPLOAD_MEDIA_TYPE.voice);
    assert.equal(upload.body!.media_type, 4);

    const item = sentItem(calls);
    assert.equal(item.type, ITEM_TYPE.voice);
    assert.equal(item.type, 3);
    const voice = item.voice_item as Record<string, unknown>;
    const media = voice.media as Record<string, unknown>;
    assert.equal(media.encrypt_query_param, "dl-param-1");
    assert.equal(media.encrypt_type, 1);
    assert.equal(voice.duration_ms, 2500);
    assert.equal(voice.voice_length, 2500);
    assert.ok(typeof voice.mid_size === "number" && voice.mid_size > 0);
  });

  it("omits duration fields when unknown", async () => {
    const calls = installFetch();
    await client().sendVoice({ ...peer, voice: Buffer.from("abc") });
    const voice = sentItem(calls).voice_item as Record<string, unknown>;
    assert.equal("duration_ms" in voice, false);
    assert.equal("voice_length" in voice, false);
  });

  it("rejects an empty buffer before any network call", async () => {
    const calls = installFetch();
    await assert.rejects(
      () => client().sendVoice({ ...peer, voice: Buffer.alloc(0) }),
      /buffer is empty/,
    );
    assert.equal(calls.length, 0);
  });

  it("rejects oversized payloads before uploading", async () => {
    const calls = installFetch();
    // mediaMaxBytes has a 1KB floor, so stay above it to exercise the check.
    await assert.rejects(
      () =>
        client({ mediaMaxBytes: 2048 }).sendVoice({
          ...peer,
          voice: Buffer.alloc(4096),
        }),
      /media too large/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("sendVideo / sendFile", () => {
  it("sendVideo uses media_type 2 and the inferred video item type", async () => {
    const calls = installFetch();
    await client().sendVideo({ ...peer, video: Buffer.from("vid"), durationMs: 9 });
    assert.equal(
      calls.find((c) => c.path.endsWith("/getuploadurl"))!.body!.media_type,
      2,
    );
    const item = sentItem(calls);
    assert.equal(item.type, ITEM_TYPE.video);
    assert.ok(item.video_item);
  });

  it("sendFile uses media_type 3 and carries the file name", async () => {
    const calls = installFetch();
    await client().sendFile({
      ...peer,
      file: Buffer.from("hello"),
      fileName: " notes.txt ",
    });
    assert.equal(
      calls.find((c) => c.path.endsWith("/getuploadurl"))!.body!.media_type,
      3,
    );
    const file = sentItem(calls).file_item as Record<string, unknown>;
    assert.equal(file.file_name, "notes.txt");
    assert.equal(file.file_size, 5);
  });

  it("sendFile requires a name", async () => {
    installFetch();
    await assert.rejects(
      () => client().sendFile({ ...peer, file: Buffer.from("x"), fileName: "  " }),
      /fileName is required/,
    );
  });

  it("honours an item type override so ops can correct the inferred numbers", async () => {
    const calls = installFetch();
    await client().sendVideo({
      ...peer,
      video: Buffer.from("vid"),
      itemType: 5,
    });
    assert.equal(sentItem(calls).type, 5);
  });
});

describe("downloadMedia", () => {
  const aesKeyHex = "0123456789abcdef0123456789abcdef";

  it("decrypts CDN bytes and sniffs the mime", async () => {
    const cipher = encryptAes128Ecb(PNG, parseAesKey(aesKeyHex));
    installFetch({ cdnDownload: { body: cipher } });

    const ref: InboundMediaRef = {
      kind: "image",
      index: 0,
      encryptQueryParam: "eqp",
      aesKey: aesKeyHex,
      encryptType: 1,
    };
    const out = await client().downloadMedia(ref);

    assert.equal(out.kind, "image");
    assert.equal(out.mime, "image/png");
    assert.deepEqual(out.data, PNG);
  });

  it("builds the download URL from the CDN base and the encrypted param", async () => {
    const cipher = encryptAes128Ecb(PNG, parseAesKey(aesKeyHex));
    const calls = installFetch({ cdnDownload: { body: cipher } });
    await client().downloadMedia({
      kind: "image",
      index: 0,
      encryptQueryParam: "a b&c",
      aesKey: aesKeyHex,
    });
    const dl = calls.find((c) => c.path.endsWith("/download"))!;
    assert.ok(dl.url.startsWith("https://cdn.test/c2c/download?"));
    assert.ok(dl.url.includes(encodeURIComponent("a b&c")));
  });

  it("prefers an absolute full_url when it points at the CDN", async () => {
    const calls = installFetch({ cdnDownload: { body: PNG } });
    await client().downloadMedia({
      kind: "image",
      index: 0,
      fullUrl: "https://novac2c.cdn.weixin.qq.com/c2c/download?z=1",
    });
    const dl = calls.find((c) => c.path.endsWith("/download"))!;
    assert.equal(dl.url, "https://novac2c.cdn.weixin.qq.com/c2c/download?z=1");
  });

  it("ignores an off-CDN full_url and rebuilds from our own base", async () => {
    // full_url arrives on an inbound message, so honouring it unchecked would
    // be an SSRF primitive against whatever this box can reach.
    const calls = installFetch({ cdnDownload: { body: PNG } });
    await client().downloadMedia({
      kind: "image",
      index: 0,
      fullUrl: "http://169.254.169.254/latest/meta-data/",
      encryptQueryParam: "eqp",
    });
    const dl = calls.find((c) => c.path.endsWith("/download"))!;
    assert.ok(
      dl.url.startsWith("https://cdn.test/c2c/download?"),
      `should have rebuilt from the CDN base, got ${dl.url}`,
    );
    assert.ok(!calls.some((c) => c.url.includes("169.254.169.254")));
  });

  it("refuses an off-CDN full_url with no fallback rather than fetching it", async () => {
    const calls = installFetch({ cdnDownload: { body: PNG } });
    await assert.rejects(
      () =>
        client().downloadMedia({
          kind: "image",
          index: 0,
          fullUrl: "http://127.0.0.1:6379/",
        }),
      /full_url host not allowed/,
    );
    assert.equal(calls.length, 0, "must not have issued any request");
  });

  it("does not echo the rejected URL back, only its host", async () => {
    installFetch();
    await assert.rejects(
      () =>
        client().downloadMedia({
          kind: "image",
          index: 0,
          fullUrl: "http://10.0.0.9/secret-path?token=abc",
        }),
      (err: Error) => {
        assert.match(err.message, /10\.0\.0\.9/);
        assert.ok(!err.message.includes("secret-path"));
        assert.ok(!err.message.includes("token=abc"));
        return true;
      },
    );
  });

  it("honours an explicit mediaHostAllowlist", async () => {
    const calls = installFetch({ cdnDownload: { body: PNG } });
    await client({ mediaHostAllowlist: ["mirror.test"] }).downloadMedia({
      kind: "image",
      index: 0,
      fullUrl: "https://mirror.test/download?z=1",
    });
    assert.equal(
      calls.find((c) => c.path.endsWith("/download"))!.url,
      "https://mirror.test/download?z=1",
    );
  });

  it("accepts plaintext bytes when a vestigial aes_key fails to decrypt", async () => {
    installFetch({ cdnDownload: { body: PNG } });
    const out = await client().downloadMedia({
      kind: "image",
      index: 0,
      encryptQueryParam: "eqp",
      aesKey: aesKeyHex,
      encryptType: 1,
    });
    assert.equal(out.mime, "image/png");
    assert.deepEqual(out.data, PNG);
  });

  it("skips decryption when encrypt_type is 0", async () => {
    installFetch({ cdnDownload: { body: PNG } });
    const out = await client().downloadMedia({
      kind: "image",
      index: 0,
      encryptQueryParam: "eqp",
      aesKey: aesKeyHex,
      encryptType: 0,
    });
    assert.deepEqual(out.data, PNG);
  });

  it("rejects on the mid_size hint without fetching", async () => {
    const calls = installFetch({ cdnDownload: { body: PNG } });
    await assert.rejects(
      () =>
        client().downloadMedia(
          { kind: "image", index: 0, encryptQueryParam: "eqp", cipherSize: 9999 },
          { maxBytes: 2048 },
        ),
      /media too large/,
    );
    assert.equal(calls.length, 0);
  });

  it("rejects on a declared Content-Length over the cap", async () => {
    installFetch({
      cdnDownload: { body: PNG, headers: { "content-length": "9999" } },
    });
    await assert.rejects(
      () =>
        client().downloadMedia(
          { kind: "image", index: 0, encryptQueryParam: "eqp" },
          { maxBytes: 1024 },
        ),
      /media too large/,
    );
  });

  it("aborts mid-stream when the body exceeds the cap despite no Content-Length", async () => {
    installFetch({ cdnDownload: { body: Buffer.alloc(9000, 7) } });
    await assert.rejects(
      () =>
        client().downloadMedia(
          { kind: "image", index: 0, encryptQueryParam: "eqp" },
          { maxBytes: 2048 },
        ),
      /exceeded 2048 bytes/,
    );
  });

  it("requires somewhere to fetch from", async () => {
    installFetch();
    await assert.rejects(
      () => client().downloadMedia({ kind: "image", index: 0 }),
      /neither full_url nor encrypt_query_param/,
    );
  });
});
