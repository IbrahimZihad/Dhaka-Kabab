import { describe, expect, it } from "vitest";
import { allowedOrigins, assertSameOrigin, ok, route } from "@/lib/api";
import { isAppError } from "@/lib/errors";

/**
 * `src/lib/api.ts` — the cross-origin gate. Two failure modes matter here: a check
 * that is too loose lets another site ride a staff member's session cookie, and a
 * check that is too strict rejects a real customer whenever the app is reached by
 * IP, by an alias host, or through a reverse proxy whose internal origin differs
 * from the public one. Both directions are asserted.
 */

const PATH = "/api/payments";

function post(origin?: string, host = "127.0.0.1:3000"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request(`http://${host}${PATH}`, { method: "POST", headers, body: "{}" });
}

describe("allowedOrigins", () => {
  it("always contains the origin the server sees for its own URL", () => {
    const request = post();
    const allowed = allowedOrigins(request);
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed).toContain(new URL(request.url).origin);
  });

  it("aliases localhost and 127.0.0.1 onto each other, and invents no other host", () => {
    const loopback = allowedOrigins(post(undefined, "localhost:3000"));
    expect(loopback.some((origin) => origin.includes("127.0.0.1"))).toBe(true);

    // A public host is accepted as itself; the alias rule must not start guessing
    // other ports or schemes, or the gate stops meaning anything.
    const publicHost = allowedOrigins(post(undefined, "kabab.example.com"));
    expect(publicHost).toContain("http://kabab.example.com");
    expect(publicHost).not.toContain("http://kabab.example.com:3000");
    expect(publicHost).not.toContain("https://kabab.example.com");
  });
});

describe("assertSameOrigin", () => {
  it("accepts the origin the browser actually used", () => {
    expect(() => assertSameOrigin(post("http://127.0.0.1:3000"))).not.toThrow();
    expect(() => assertSameOrigin(post("http://localhost:3000"))).not.toThrow();
  });

  it("tolerates a trailing slash on the Origin header", () => {
    expect(() => assertSameOrigin(post("http://127.0.0.1:3000/"))).not.toThrow();
  });

  it("refuses another site's origin", () => {
    for (const origin of ["https://evil.example", "http://localhost:4000", "https://127.0.0.1:3000"]) {
      let caught: unknown;
      try {
        assertSameOrigin(post(origin));
      } catch (error) {
        caught = error;
      }
      expect(isAppError(caught) && caught.code).toBe("FORBIDDEN");
    }
  });

  it("lets a request with no Origin header through, because server-to-server callers send none", () => {
    expect(() => assertSameOrigin(post())).not.toThrow();
    expect(() => assertSameOrigin(new Request(`http://127.0.0.1:3000${PATH}`, { method: "DELETE" }))).not.toThrow();
  });
});

describe("route() origin enforcement", () => {
  // Each handler names the request it will receive: that is what tells `route()`'s
  // generic that this is a route taking a Request, which is also what switches the
  // cross-origin gate on.
  const handler = route(async (request: Request) => ok({ path: new URL(request.url).pathname }));
  const permissive = route(async (request: Request) => ok({ path: new URL(request.url).pathname }), {
    allowForeignOrigin: true,
  });

  it("rejects a cross-origin write before the handler runs", async () => {
    let ran = false;
    const guarded = route(async (request: Request) => {
      ran = true;
      return ok({ path: new URL(request.url).pathname });
    });
    const response = await guarded(post("https://evil.example"));
    expect(response.status).toBe(403);
    expect(ran).toBe(false);
  });

  it("runs the handler for a same-origin write", async () => {
    const response = await handler(post("http://127.0.0.1:3000"));
    expect(response.status).toBe(200);
  });

  it("never checks the origin of a read", async () => {
    const read = route(async (request: Request) => ok({ path: new URL(request.url).pathname }));
    const response = await read(new Request(`http://127.0.0.1:3000${PATH}`, { method: "GET", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(200);
  });

  it("honours the gateway opt-out for a foreign-origin notification", async () => {
    const response = await permissive(post("https://sandbox.sslcommerz.com"));
    expect(response.status).toBe(200);
  });
});
