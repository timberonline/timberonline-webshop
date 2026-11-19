import type { EmailOtpType } from "@supabase/supabase-js";

/** Alleen deze e-maillinktypen mogen een beheersessie openen (uitnodiging, wachtwoord herstellen). */
export const ALLOWED_LINK_TYPES = ["invite", "recovery"] as const satisfies readonly EmailOtpType[];
export type AllowedLinkType = (typeof ALLOWED_LINK_TYPES)[number];

export function isAllowedLinkType(t: string | null | undefined): t is AllowedLinkType {
  return !!t && (ALLOWED_LINK_TYPES as readonly string[]).includes(t);
}

/** Alleen interne beheerpaden; nooit `//host` of een absolute URL. */
export function safeAdminNext(next: string | null | undefined): string {
  return next && next.startsWith("/beheer") && !next.startsWith("//") ? next : "/beheer";
}
