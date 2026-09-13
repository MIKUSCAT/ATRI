import { ILinkClient, ILinkError } from "./client.js";
import type { QrcodeResponse, QrcodeStatusResponse } from "./types.js";

export interface LoginResult {
  botToken: string;
  baseUrl?: string;
  accountId?: string;
  raw: QrcodeStatusResponse;
}

export interface LoginOptions {
  client?: ILinkClient;
  botType?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onQrcode?: (info: {
    qrcode: string;
    qrcodeImgContent?: string;
    qrcodeUrl?: string;
  }) => void;
  onStatus?: (status: string, raw: QrcodeStatusResponse) => void;
  signal?: AbortSignal;
}

/** Normalize scan link for user / web UI. */
export function resolveQrOpenUrl(qr: QrcodeResponse): string | undefined {
  if (qr.qrcode_img_content?.startsWith("http")) {
    return qr.qrcode_img_content;
  }
  if (qr.qrcode_url?.startsWith("http")) {
    return qr.qrcode_url;
  }
  if (qr.qrcode) {
    return `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=${encodeURIComponent(qr.qrcode)}&bot_type=3`;
  }
  return undefined;
}

/**
 * Interactive QR login against iLink.
 * Returns bot_token when status is confirmed/scanned success.
 */
export async function loginWithQrcode(
  opts: LoginOptions = {},
): Promise<LoginResult> {
  const client = opts.client ?? new ILinkClient();
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const started = Date.now();

  const qr = await client.getBotQrcode(opts.botType ?? 3);
  if (!qr.qrcode) {
    throw new ILinkError(
      qr.errmsg ?? "get_bot_qrcode missing qrcode field",
      qr.ret,
      undefined,
      qr,
    );
  }

  opts.onQrcode?.({
    qrcode: qr.qrcode,
    qrcodeImgContent: qr.qrcode_img_content,
    qrcodeUrl: resolveQrOpenUrl(qr) ?? qr.qrcode_url,
  });

  while (true) {
    if (opts.signal?.aborted) {
      throw new ILinkError("login aborted");
    }
    if (Date.now() - started > timeoutMs) {
      throw new ILinkError("login timed out waiting for QR scan");
    }

    let status: QrcodeStatusResponse;
    try {
      status = await client.getQrcodeStatus(qr.qrcode);
    } catch (err) {
      // Long-poll timeout / transient network — keep waiting
      if (err instanceof ILinkError && (err.body as { aborted?: boolean })?.aborted) {
        opts.onStatus?.("waiting", { status: "waiting" });
        continue;
      }
      if (err instanceof Error && /timed out|aborted|fetch failed|ECONNRESET/i.test(err.message)) {
        opts.onStatus?.("retry", { status: "retry" });
        await sleep(pollIntervalMs, opts.signal);
        continue;
      }
      throw err;
    }

    const st = (status.status ?? "").toLowerCase();
    opts.onStatus?.(st || "unknown", status);

    if (
      st === "confirmed" ||
      st === "confirmed_login" ||
      st === "success" ||
      Boolean(status.bot_token)
    ) {
      if (!status.bot_token) {
        throw new ILinkError(
          "QR confirmed but bot_token missing",
          status.ret,
          undefined,
          status,
        );
      }
      if (status.baseurl) {
        client.setBaseUrl(status.baseurl);
      }
      client.setBotToken(status.bot_token);
      return {
        botToken: status.bot_token,
        baseUrl: status.baseurl,
        accountId: status.account_id ?? status.ilink_bot_id,
        raw: status,
      };
    }

    if (st === "expired" || st === "cancel" || st === "cancelled") {
      throw new ILinkError(`QR login ${st}`, status.ret, undefined, status);
    }

    // wait_scan / scanned / etc. — brief pause before next long-poll
    await sleep(Math.min(pollIntervalMs, 500), opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ILinkError("login aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ILinkError("login aborted"));
      },
      { once: true },
    );
  });
}
