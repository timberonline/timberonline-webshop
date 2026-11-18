"use server";
import { headers } from "next/headers";
import { getCtx } from "@/server/services/runtime";
import {
  contactInputFromFormData,
  EMPTY_CONTACT_VALUES,
  submitContact,
  type ContactErrors,
  type ContactValues,
} from "@/server/services/contact";

export type ContactFormState = {
  status: "idle" | "invalid" | "sent" | "inactive" | "rate_limited" | "failed";
  errors: ContactErrors;
  /** Ingevulde waarden terug naar het formulier, zodat niets verloren gaat bij een fout. */
  values: ContactValues;
  /** Gesimuleerde verzending (MAIL_MODE=simulated): melden aan de bezoeker van de testomgeving. */
  simulated?: boolean;
  /** Telt per inzending; het formulier gebruikt dit als key om waarden opnieuw te tonen. */
  seq: number;
};

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "onbekend";
}

export async function contactAction(prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const input = contactInputFromFormData(formData);
  const values: ContactValues = { name: input.name, email: input.email, order: input.order, subject: input.subject, message: input.message };
  const seq = (prev?.seq ?? 0) + 1;
  const result = await submitContact(input, { mail: getCtx().mail, clientKey: await clientKey() });
  switch (result.status) {
    case "invalid":
      return { status: "invalid", errors: result.errors, values, seq };
    case "sent":
      return { status: "sent", errors: {}, values: EMPTY_CONTACT_VALUES, simulated: result.delivery === "simulated", seq };
    case "ignored":
      return { status: "sent", errors: {}, values: EMPTY_CONTACT_VALUES, seq };
    default:
      return { status: result.status, errors: {}, values, seq };
  }
}
