import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth/supabase";
import { isAllowedLinkType, safeAdminNext } from "../link";

/**
 * Rondt een e-maillink af:
 * - PKCE (`?code=`): wachtwoord herstellen vanaf het loginscherm; gebonden aan deze browser (code verifier).
 * - token-hash (`?token_hash=&type=`): NIET direct afronden op GET (login-CSRF, linkscanners in mailprogramma's),
 *   maar doorsturen naar een bevestigingspagina; pas na een klik verifieert een server action de link.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeAdminNext(url.searchParams.get("next"));
  if (tokenHash && isAllowedLinkType(type)) {
    const to = new URL("/beheer/link-bevestigen", url.origin);
    to.searchParams.set("token_hash", tokenHash);
    to.searchParams.set("type", type);
    to.searchParams.set("next", next);
    return NextResponse.redirect(to);
  }
  const supabase = await createAuthClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/beheer/login", url.origin));
}
