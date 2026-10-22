import { afterEach, describe, expect, it } from "vitest";
import { buildSmtpMailOptions } from "@/lib/email";

const original = process.env.EMAIL_REPLY_TO;

afterEach(() => {
  if (original === undefined) delete process.env.EMAIL_REPLY_TO;
  else process.env.EMAIL_REPLY_TO = original;
});

const message = {
  to: "user@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("EMAIL_REPLY_TO", () => {
  it("adds the Reply-To header when the address is set", () => {
    process.env.EMAIL_REPLY_TO = "support@myautoeco.com";
    expect(buildSmtpMailOptions(message).replyTo).toBe("support@myautoeco.com");
  });

  it("trims surrounding whitespace", () => {
    process.env.EMAIL_REPLY_TO = "  support@myautoeco.com  ";
    expect(buildSmtpMailOptions(message).replyTo).toBe("support@myautoeco.com");
  });

  it("omits the header entirely when unset", () => {
    delete process.env.EMAIL_REPLY_TO;
    expect("replyTo" in buildSmtpMailOptions(message)).toBe(false);
  });

  it("omits the header when the value is blank", () => {
    process.env.EMAIL_REPLY_TO = "   ";
    expect("replyTo" in buildSmtpMailOptions(message)).toBe(false);
  });
});
