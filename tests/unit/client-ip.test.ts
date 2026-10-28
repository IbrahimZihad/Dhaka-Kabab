import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "@/lib/api";

/**
 * `clientIp()` is the only thing standing between a caller and every IP-keyed rate
 * limit and audit row in the app, so the assertions are about who is allowed to
 * *write* the address we act on. `TRUSTED_PROXY_HOPS` is read per call, which is why
 * each case sets it itself rather than relying on the environment file.
 */

const HOPS = "TRUSTED_PROXY_HOPS";
const previous = process.env[HOPS];
afterEach(() => {
  if (previous === undefined) delete process.env[HOPS];
  else process.env[HOPS] = previous;
});

function get(headers: Record<string, string>): string {
  return clientIp(new Request("http://127.0.0.1:3000/api/orders", { headers }));
}

describe("clientIp", () => {
  it("refuses to read any forwarded header when no proxy was declared", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(get({ "x-forwarded-for": "203.0.113.9" })).toBe("unknown");
    expect(get({ "x-real-ip": "203.0.113.9" })).toBe("unknown");
    expect(get({})).toBe("unknown");
  });

  it("takes the entry the one declared proxy appended, not the one the client wrote", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    // The leftmost address is the caller's invention; the rightmost is ours.
    expect(get({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" })).toBe("203.0.113.9");
    expect(get({ "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
    expect(get({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("counts from the right for each proxy in front of the app", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const request = { "x-forwarded-for": "198.51.100.7, 203.0.113.9, 192.0.2.44" };
    expect(get(request)).toBe("203.0.113.9");
    // A chain shorter than the declared hops did not come from our own proxies, so
    // there is no honest address in it.
    expect(get({ "x-forwarded-for": "203.0.113.9" })).toBe("unknown");
    expect(get({ "x-forwarded-for": "203.0.113.9, 192.0.2.44" })).toBe("203.0.113.9");
    // x-real-ip is one proxy's own rewrite; with two hops it proves nothing about
    // the client behind the list that was never written.
    expect(get({ "x-real-ip": "203.0.113.9" })).toBe("unknown");
  });

  it("tolerates whitespace and empty entries in the list", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(get({ "x-forwarded-for": " 198.51.100.7 , 203.0.113.9 ,, " })).toBe("203.0.113.9");
  });

  it("treats a nonsense hop count as no proxy at all", () => {
    for (const value of ["banana", "-3", "0", ""]) {
      process.env.TRUSTED_PROXY_HOPS = value;
      expect(get({ "x-forwarded-for": "203.0.113.9" })).toBe("unknown");
    }
  });
});
