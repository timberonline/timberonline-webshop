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

/**
 * De link-token reist van de callback naar de bevestigingspagina via een kortlevende httpOnly-cookie, zodat hij
 * niet in de URL (Referer, geschiedenis, logs) van de bevestigingspagina staat en aan deze browser gebonden is.
 */
export const LINK_COOKIE = "to_admin_link";
export const LINK_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/beheer", maxAge: 600 };

export type PendingLink = { tokenHash: string; type: AllowedLinkType; next: string };

export function encodePendingLink(l: PendingLink): string {
  return Buffer.from(JSON.stringify(l), "utf8").toString("base64url");
}

export function decodePendingLink(raw: string | undefined | null): PendingLink | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PendingLink>;
    if (typeof v.tokenHash !== "string" || !v.tokenHash || !isAllowedLinkType(v.type)) return null;
    return { tokenHash: v.tokenHash, type: v.type, next: safeAdminNext(v.next) };
  } catch {
    return null;
  }
}
