import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { auditLog } from "./audit";
import { renderEmailCopy } from "./email-i18n";
import { coerceLocale, type Locale } from "./i18n";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ ok: boolean; error?: string }>;
  getName(): string;
}

class ConsoleProvider implements EmailProvider {
  getName() {
    return "console";
  }
  async send(msg: EmailMessage): Promise<{ ok: boolean }> {
    // eslint-disable-next-line no-console
    console.log(`[email:console] -> ${msg.to} | ${msg.subject}`);
    if (msg.text) {
      // eslint-disable-next-line no-console
      console.log(msg.text);
    } else {
      // eslint-disable-next-line no-console
      console.log(msg.html.replace(/<[^>]+>/g, "").slice(0, 500));
    }
    await auditLog({
      action: "email.sent",
      metadata: { provider: "console", to: maskEmail(msg.to), subject: msg.subject },
    });
    return { ok: true };
  }
}

class SmtpProvider implements EmailProvider {
  private transporter: Transporter | null = null;
  getName() {
    return "smtp";
  }
  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth:
          env.smtpUser || env.smtpPass
            ? { user: env.smtpUser, pass: env.smtpPass }
            : undefined,
      });
    }
    return this.transporter;
  }
  async send(msg: EmailMessage): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.getTransporter().sendMail({
        from: env.emailFrom,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      await auditLog({
        action: "email.sent",
        metadata: { provider: "smtp", to: maskEmail(msg.to), subject: msg.subject },
      });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: "email.failed",
        metadata: { provider: "smtp", to: maskEmail(msg.to), error },
      });
      return { ok: false, error };
    }
  }
}

let providerInstance: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (providerInstance) return providerInstance;
  providerInstance =
    env.emailProvider === "smtp" && env.smtpHost ? new SmtpProvider() : new ConsoleProvider();
  return providerInstance;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; error?: string }> {
  return getEmailProvider().send(msg);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

// ---- Transactional templates (plain HTML + text) -----------------------------

function localeOf(v: string | null | undefined): Locale {
  return coerceLocale(v);
}

export function tplWelcome(name: string | null, appUrl: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "welcome", {
    name: escape(name ?? "there"),
    appUrl,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplEmailVerify(name: string | null, link: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "emailVerify", {
    name: escape(name ?? "there"),
    link,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplPasswordReset(name: string | null, link: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "passwordReset", {
    name: escape(name ?? "there"),
    link,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplSignupAttemptNotice(name: string | null, appUrl: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "signupAttemptNotice", {
    name: escape(name ?? "there"),
    appUrl,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplTrialStarted(name: string | null, appUrl: string, days: number, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "trialStarted", {
    name: escape(name ?? "there"),
    appUrl,
    days,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplTrialEnding(name: string | null, daysLeft: number, appUrl: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "trialEnding", {
    name: escape(name ?? "there"),
    appUrl,
    days: daysLeft,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplPaymentSuccess(name: string | null, planName: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "paymentSuccess", {
    name: escape(name ?? "there"),
    planName: escape(planName),
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplPaymentFailed(name: string | null, appUrl: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "paymentFailed", {
    name: escape(name ?? "there"),
    appUrl,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplSubscriptionCanceled(name: string | null, endDate: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "subscriptionCanceled", {
    name: escape(name ?? "there"),
    endDate,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

export function tplUsageLimitReached(name: string | null, label: string, appUrl: string, localeValue?: string | null): EmailMessage {
  const c = renderEmailCopy(localeOf(localeValue), "usageLimitReached", {
    name: escape(name ?? "there"),
    label: escape(label),
    appUrl,
  });
  return {
    to: "",
    subject: c.subject,
    html: c.html,
    text: c.text,
  };
}

// NOTE: `tplReferralConverted` and `tplAffiliatePayout` were removed on
// purpose. Their triggering systems are stubs — `referrals.ts` and
// `affiliates.ts` are documented as "V2 / unavailable" and export no-op
// functions — so neither email can ever be sent. Keeping unreachable templates
// is worse than removing them: `scripts/launch-check.mjs` reports templates
// with no caller, and a template with no caller is usually a sign that someone
// believes the feature is live. Reinstate them together with the real
// referral/affiliate implementation.

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
