"use server";
import { headers } from "next/headers";
import { createSharedRateLimiter, type RateLimiter } from "@/server/services/contact";
import { getCtx } from "@/server/services/runtime";
import { EMPTY_WITHDRAWAL, submitWithdrawal, type WithdrawalErrors, type WithdrawalValues } from "@/server/services/withdrawal";

export type WithdrawalFormState = {
  status: "idle" | "invalid" | "received" | "rate_limited" | "failed";
  errors: WithdrawalErrors;
  values: WithdrawalValues;
  reference?: string;
  submittedAt?: string;
  acknowledged?: boolean;
  seq: number;
};

let limiter: RateLimiter | undefined;

async function clientKey() {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "onbekend";
}

const get = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.slice(0, 5000) : "";
};

export async function withdrawalAction(prev: WithdrawalFormState, fd: FormData): Promise<WithdrawalFormState> {
  const values: WithdrawalValues = {
    name: get(fd, "name"),
    email: get(fd, "email"),
    order_number: get(fd, "order_number"),
    scope: get(fd, "scope") || "all",
    items: get(fd, "items"),
    note: get(fd, "note"),
  };
  const seq = (prev?.seq ?? 0) + 1;
  const ctx = getCtx();
  limiter ??= createSharedRateLimiter(ctx.db, { limit: 5, windowSeconds: 60 * 60, scope: "withdrawal" });
  const r = await submitWithdrawal(
    { ...values, honeypot: get(fd, "website") },
    { db: ctx.db, mail: ctx.mail, appUrl: ctx.appUrl, clientKey: await clientKey(), limiter },
  );
  switch (r.status) {
    case "invalid":
      return { status: "invalid", errors: r.errors, values, seq };
    case "ignored":
      return { status: "received", errors: {}, values: EMPTY_WITHDRAWAL, seq };
    case "received":
      return { status: "received", errors: {}, values, reference: r.reference, submittedAt: r.submittedAt, acknowledged: r.acknowledged, seq };
    default:
      return { status: r.status, errors: {}, values, seq };
  }
}
