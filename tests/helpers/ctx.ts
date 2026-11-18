import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Stripe from "stripe";
import type { Db } from "@/server/db/types";
import type { Ctx } from "@/server/services/context";
import { createLocalStorage } from "@/server/storage";
import { createSimulatedMail, type MailMessage } from "@/server/integrations/mail";
import { createSimulatedBol } from "@/server/integrations/bol";
import { createSimulatedCarriers } from "@/server/integrations/carriers";

export type FakeStripe = {
  sessions: Map<string, Record<string, unknown>>;
  refunds: { id: string; payment_intent: string; amount: number; status: string }[];
  calls: string[];
  failCreate?: boolean;
};

/** Minimale nep-Stripe voor tests: geen netwerk, wel dezelfde vorm als de SDK-aanroepen die we gebruiken. */
export function fakeStripe(): { stripe: Stripe; state: FakeStripe } {
  const state: FakeStripe = { sessions: new Map(), refunds: [], calls: [] };
  let n = 0;
  const stripe = {
    checkout: {
      sessions: {
        async create(params: Record<string, unknown>, opts: { idempotencyKey?: string }) {
          state.calls.push(`create:${opts?.idempotencyKey}`);
          if (state.failCreate) throw new Error("Stripe onbereikbaar");
          const id = `cs_test_${++n}_${Math.random().toString(36).slice(2, 10)}`;
          const s = { id, url: `https://checkout.stripe.test/${id}`, status: "open", ...params };
          state.sessions.set(id, s);
          return s;
        },
        async retrieve(id: string) {
          return state.sessions.get(id);
        },
        async expire(id: string) {
          const s = state.sessions.get(id);
          if (s) s.status = "expired";
          state.calls.push(`expire:${id}`);
          return s;
        },
      },
    },
    paymentIntents: {
      async retrieve(id: string) {
        return { id, payment_method_types: ["ideal"], latest_charge: { payment_method_details: { type: "ideal" } } };
      },
    },
    refunds: {
      async create(params: { payment_intent: string; amount: number }, opts: { idempotencyKey: string }) {
        state.calls.push(`refund:${opts.idempotencyKey}`);
        const r = { id: `re_test_${++n}_${Math.random().toString(36).slice(2, 10)}`, payment_intent: params.payment_intent, amount: params.amount, status: "succeeded" };
        state.refunds.push(r);
        return r;
      },
      async list({ payment_intent }: { payment_intent: string }) {
        return { data: state.refunds.filter((r) => r.payment_intent === payment_intent) };
      },
    },
  } as unknown as Stripe;
  return { stripe, state };
}

export function testCtx(db: Db, opts: { stripe?: Stripe | null; bolFaults?: { failNext?: number; delayMs?: number }; storageDir?: string } = {}) {
  const sink: MailMessage[] = [];
  const dir = opts.storageDir ?? mkdtempSync(path.join(os.tmpdir(), "to-storage-"));
  const bol = createSimulatedBol(db, opts.bolFaults ?? {});
  const ctx: Ctx = {
    db,
    storage: createLocalStorage(dir),
    mail: createSimulatedMail(sink),
    bol,
    carriers: createSimulatedCarriers(),
    stripe: opts.stripe === undefined ? fakeStripe().stripe : opts.stripe,
    appUrl: "http://localhost:3000",
  };
  return { ctx, sink, bol, storageDir: dir };
}

export function checkoutEvent(type: string, session: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return { id, type, data: { object: session } } as unknown as Stripe.Event;
}

export function paidSession(orderId: string, sessionId: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: amount,
    client_reference_id: orderId,
    metadata: { order_id: orderId },
    payment_intent: `pi_${orderId.slice(0, 8)}`,
    customer_details: { email: "Klant@Example.test", name: "Test Klant", phone: null, address: null },
    collected_information: {
      shipping_details: { name: "Test Klant", address: { line1: "Teststraat 12A", line2: null, postal_code: "1234ab", city: "Teststad", country: "NL" } },
    },
    ...extra,
  };
}
