import { Resend } from "resend";

export type MailMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string };
export type MailResult = { status: "sent" | "simulated"; providerId: string | null };

export interface MailDriver {
  readonly mode: "resend" | "simulated";
  send(msg: MailMessage): Promise<MailResult>;
}

export function createSimulatedMail(sink?: MailMessage[]): MailDriver {
  return {
    mode: "simulated",
    async send(msg) {
      sink?.push(msg);
      return { status: "simulated", providerId: null };
    },
  };
}

/** Resend. Met MAIL_TEST_RECIPIENT gaan alle berichten naar één gecontroleerd adres (testmodus). */
export function createResendMail(opts: { apiKey: string; from: string; replyTo?: string; testRecipient?: string }): MailDriver {
  const resend = new Resend(opts.apiKey);
  return {
    mode: "resend",
    async send(msg) {
      const to = opts.testRecipient ?? msg.to;
      const subject = opts.testRecipient ? `[TEST → ${msg.to}] ${msg.subject}` : msg.subject;
      const { data, error } = await resend.emails.send(
        { from: opts.from, to: [to], subject, html: msg.html, text: msg.text, ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) },
        { idempotencyKey: msg.idempotencyKey },
      );
      if (error) throw new Error(`Resend: ${error.message}`);
      return { status: "sent", providerId: data?.id ?? null };
    },
  };
}
