import { randomInt } from "node:crypto";

/** Random X-WECHAT-UIN: uint32 decimal string, base64-encoded (per-request anti-replay). */
export function randomWechatUinHeader(): string {
  const n = randomInt(0, 0xffffffff);
  return Buffer.from(String(n), "utf8").toString("base64");
}

export function buildILinkHeaders(botToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUinHeader(),
  };
  if (botToken) {
    headers.Authorization = `Bearer ${botToken}`;
  }
  return headers;
}
