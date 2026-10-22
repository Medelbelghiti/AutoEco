import { describe, expect, it } from "vitest";
import { isCrossOriginWrite, isSafeMethod } from "@/lib/csrf";

const HOST = "www.myautoeco.com";

describe("same-origin write check", () => {
  it("never inspects safe methods", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get", "head", "options"]) {
      expect(isSafeMethod(m), m).toBe(true);
      expect(isCrossOriginWrite(m, "https://evil.example", HOST), m).toBe(false);
    }
  });

  it("allows same-origin writes", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isCrossOriginWrite(m, `https://${HOST}`, HOST), m).toBe(false);
      expect(isCrossOriginWrite(m, `http://${HOST}`, HOST), m).toBe(false);
      // A different port on the same host is still our origin.
      expect(isCrossOriginWrite(m, `https://${HOST}:3000`, `${HOST}:3000`), m).toBe(false);
    }
  });

  it("refuses cross-origin writes", () => {
    for (const origin of [
      "https://evil.example",
      "https://evil.example:443",
      "http://www.myautoeco.com.evil.example",
      "https://myautoeco.com", // apex vs www
    ]) {
      expect(isCrossOriginWrite("POST", origin, HOST), origin).toBe(true);
    }
  });

  it("refuses the opaque 'null' origin emitted by sandboxed frames", () => {
    expect(isCrossOriginWrite("POST", "null", HOST)).toBe(true);
    expect(isCrossOriginWrite("POST", "about:blank", HOST)).toBe(true);
  });

  it("allows requests with no Origin header — webhooks, cron and curl", () => {
    // Paddle and PayPal deliver server-to-server and never send an Origin.
    // Refusing these would break every webhook on the platform.
    expect(isCrossOriginWrite("POST", null, HOST)).toBe(false);
    expect(isCrossOriginWrite("POST", "", HOST)).toBe(false);
  });

  it("fails open when no Host header is present rather than bricking the API", () => {
    expect(isCrossOriginWrite("POST", "https://evil.example", null)).toBe(false);
  });

  it("treats a malformed origin as cross-origin", () => {
    expect(isCrossOriginWrite("POST", "not a url", HOST)).toBe(true);
  });
});
