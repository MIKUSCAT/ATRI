import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ILinkClient } from "./client.js";

interface Call {
  path: string;
  body: Record<string, unknown>;
}

type Reply = { status?: number; body: unknown };
type Handler = (path: string, body: Record<string, unknown>) => Reply;

let restoreFetch: (() => void) | null = null;

function installFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
    restoreFetch = null;
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    calls.push({ path, body });
    const reply = handler(path, body);
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      headers: new Headers(),
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return calls;
}

function client(overrides: Record<string, unknown> = {}): ILinkClient {
  return new ILinkClient({
    botToken: "tok",
    baseUrl: "https://ilink.test",
    ...overrides,
  });
}

const peer = { toUserId: "peer-1", contextToken: "ctx-1" };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  restoreFetch?.();
});

describe("typing indicator protocol", () => {
  it("fetches a ticket then sends status 1 by default", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: "tkt-abc" } }
        : { body: { ret: 0 } },
    );

    await client().sendTyping(peer);

    assert.deepEqual(
      calls.map((c) => c.path),
      ["/ilink/bot/getconfig", "/ilink/bot/sendtyping"],
    );
    assert.equal(calls[0]!.body.ilink_user_id, "peer-1");
    assert.equal(calls[0]!.body.context_token, "ctx-1");
    assert.equal(calls[1]!.body.typing_ticket, "tkt-abc");
    assert.equal(calls[1]!.body.status, 1);
  });

  it("startTyping sends 1 and stopTyping sends 2", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: "tkt" } }
        : { body: { ret: 0 } },
    );
    const c = client();

    await c.startTyping(peer);
    await c.stopTyping(peer);

    const statuses = calls
      .filter((x) => x.path.endsWith("/sendtyping"))
      .map((x) => x.body.status);
    assert.deepEqual(statuses, [1, 2]);
  });

  it("caches the ticket across calls (one getconfig per peer)", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: "tkt" } }
        : { body: { ret: 0 } },
    );
    const c = client();

    await c.startTyping(peer);
    await c.startTyping(peer);
    await c.startTyping(peer);

    assert.equal(
      calls.filter((x) => x.path.endsWith("/getconfig")).length,
      1,
      "ticket should be reused",
    );
    assert.equal(c.getCachedTypingTicket("peer-1"), "tkt");
  });

  it("collapses concurrent ticket fetches into one getconfig", async () => {
    const gate = deferred<void>();
    let getConfigCalls = 0;
    installFetch((path) => {
      if (path.endsWith("/getconfig")) {
        getConfigCalls++;
        return { body: { ret: 0, typing_ticket: "tkt" } };
      }
      return { body: { ret: 0 } };
    });
    // Hold the first getconfig open so the second caller has to join it.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith("/getconfig")) await gate.promise;
      return original(input as string, init);
    }) as typeof globalThis.fetch;

    const c = client();
    const both = Promise.all([c.startTyping(peer), c.startTyping(peer)]);
    gate.resolve();
    await both;

    assert.equal(getConfigCalls, 1);
  });

  it("keeps separate tickets per peer", async () => {
    const calls = installFetch((path, body) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: `tkt-${body.ilink_user_id}` } }
        : { body: { ret: 0 } },
    );
    const c = client();

    await c.startTyping({ toUserId: "a", contextToken: "ctx" });
    await c.startTyping({ toUserId: "b", contextToken: "ctx" });

    assert.equal(c.getCachedTypingTicket("a"), "tkt-a");
    assert.equal(c.getCachedTypingTicket("b"), "tkt-b");
    assert.equal(calls.filter((x) => x.path.endsWith("/getconfig")).length, 2);
  });

  it("does not fetch a ticket just to stop typing", async () => {
    const calls = installFetch(() => ({ body: { ret: 0 } }));

    await client().stopTyping(peer);

    assert.deepEqual(
      calls.map((c) => c.path),
      ["/ilink/bot/sendtyping"],
      "stop with no cached ticket must not pay a getconfig round trip",
    );
    assert.equal(calls[0]!.body.status, 2);
    assert.equal(calls[0]!.body.typing_ticket, undefined);
  });

  it("still sends typing when getconfig fails", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { status: 500, body: { ret: -1, errmsg: "boom" } }
        : { body: { ret: 0 } },
    );

    await client().startTyping(peer);

    const typing = calls.filter((x) => x.path.endsWith("/sendtyping"));
    assert.equal(typing.length, 1);
    assert.equal(typing[0]!.body.typing_ticket, undefined);
    assert.equal(typing[0]!.body.status, 1);
  });

  it("refreshes a stale cached ticket once and retries", async () => {
    let issued = 0;
    let revoked = false;
    const calls = installFetch((path, body) => {
      if (path.endsWith("/getconfig")) {
        issued++;
        return { body: { ret: 0, typing_ticket: `tkt-${issued}` } };
      }
      if (revoked && body.typing_ticket === "tkt-1") {
        return { body: { ret: -3, errmsg: "invalid typing_ticket" } };
      }
      return { body: { ret: 0 } };
    });
    const c = client();

    await c.startTyping(peer); // primes tkt-1
    assert.equal(c.getCachedTypingTicket("peer-1"), "tkt-1");
    calls.length = 0;
    revoked = true; // server drops tkt-1 out from under the cache

    await c.startTyping(peer);

    assert.deepEqual(calls.map((x) => x.path), [
      "/ilink/bot/sendtyping",
      "/ilink/bot/getconfig",
      "/ilink/bot/sendtyping",
    ]);
    assert.equal(calls[2]!.body.typing_ticket, "tkt-2");
    assert.equal(c.getCachedTypingTicket("peer-1"), "tkt-2");
  });

  it("gives up after one retry instead of looping", async () => {
    let issued = 0;
    const calls = installFetch((path) => {
      if (path.endsWith("/getconfig")) {
        issued++;
        return { body: { ret: 0, typing_ticket: `tkt-${issued}` } };
      }
      return { body: { ret: -3, errmsg: "always invalid" } };
    });
    const c = client();

    await assert.rejects(() => c.startTyping(peer), /always invalid/);

    // first send (tkt-1) → refresh → second send (tkt-2) → stop
    assert.equal(calls.filter((x) => x.path.endsWith("/sendtyping")).length, 2);
    assert.equal(calls.filter((x) => x.path.endsWith("/getconfig")).length, 2);
  });

  it("honours an explicitly supplied ticket without calling getconfig", async () => {
    const calls = installFetch(() => ({ body: { ret: 0 } }));

    await client().startTyping({ ...peer, typingTicket: "manual" });

    assert.deepEqual(calls.map((c) => c.path), ["/ilink/bot/sendtyping"]);
    assert.equal(calls[0]!.body.typing_ticket, "manual");
  });

  it("expires cached tickets after the configured TTL", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: "tkt" } }
        : { body: { ret: 0 } },
    );
    // Floor is 60s, so ask for the minimum and then move the clock past it.
    const c = client({ typingTicketTtlMs: 1 });
    await c.startTyping(peer);
    assert.equal(calls.filter((x) => x.path.endsWith("/getconfig")).length, 1);

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      assert.equal(c.getCachedTypingTicket("peer-1"), null);
      await c.startTyping(peer);
    } finally {
      Date.now = realNow;
    }
    assert.equal(calls.filter((x) => x.path.endsWith("/getconfig")).length, 2);
  });

  it("bounds the ticket cache", async () => {
    installFetch((path, body) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: `tkt-${body.ilink_user_id}` } }
        : { body: { ret: 0 } },
    );
    // Floor is 64 entries regardless of a smaller request.
    const c = client({ typingTicketMaxEntries: 1 });
    for (let i = 0; i < 70; i++) {
      await c.startTyping({ toUserId: `p${i}`, contextToken: "ctx" });
    }

    // Oldest evicted, newest retained — never unbounded growth.
    assert.equal(c.getCachedTypingTicket("p0"), null);
    assert.equal(c.getCachedTypingTicket("p69"), "tkt-p69");
  });

  it("invalidateTypingTicket forces the next fetch", async () => {
    const calls = installFetch((path) =>
      path.endsWith("/getconfig")
        ? { body: { ret: 0, typing_ticket: "tkt" } }
        : { body: { ret: 0 } },
    );
    const c = client();

    await c.startTyping(peer);
    c.invalidateTypingTicket("peer-1");
    await c.startTyping(peer);

    assert.equal(calls.filter((x) => x.path.endsWith("/getconfig")).length, 2);
  });

  it("requires a bot token", async () => {
    installFetch(() => ({ body: { ret: 0 } }));
    const c = new ILinkClient({ baseUrl: "https://ilink.test" });
    await assert.rejects(() => c.startTyping(peer), /bot_token is required/);
  });
});
