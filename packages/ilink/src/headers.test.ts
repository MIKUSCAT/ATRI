import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildILinkHeaders, randomWechatUinHeader } from "./headers.js";

describe("headers", () => {
  it("generates base64 wechat uin", () => {
    const h = randomWechatUinHeader();
    assert.ok(h.length > 0);
    const decoded = Buffer.from(h, "base64").toString("utf8");
    assert.match(decoded, /^\d+$/);
  });

  it("includes bearer when token present", () => {
    const h = buildILinkHeaders("tok");
    assert.equal(h.Authorization, "Bearer tok");
    assert.equal(h.AuthorizationType, "ilink_bot_token");
  });
});
