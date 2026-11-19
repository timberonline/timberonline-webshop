import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAuthClient } from "@/server/auth/supabase";

/** Alleen deze e-maillinktypen mogen een sessie openen (uitnodiging beheerder, wachtwoord herstellen). */
const ALLOWED_OTP_TYPES: EmailOtpType[] = ["invite", "recovery"];

/**
 * Rondt een e-maillink af en stuurt door naar een interne beheerpagina:
 * - PKCE (`?code=`): wachtwoord herstellen vanaf het loginscherm;
 * - token-hash (`?token_hash=&type=`): uitnodiging van een beheerder vanuit Supabase (e-mailsjabloon).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/beheer";
  const safeNext = next.startsWith("/beheer") && !next.startsWith("//") ? next : "/beheer";
  const supabase = await createAuthClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  } else if (supabase && tokenHash && type && ALLOWED_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/beheer/login", url.origin));
}
