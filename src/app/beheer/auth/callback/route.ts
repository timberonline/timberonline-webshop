import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth/supabase";
import { encodePendingLink, isAllowedLinkType, LINK_COOKIE, LINK_COOKIE_OPTIONS, safeAdminNext } from "../link";

const noReferrer = (res: NextResponse) => {
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
};

/**
 * Rondt een e-maillink af:
 * - PKCE (`?code=`): wachtwoord herstellen vanaf het loginscherm; gebonden aan deze browser (code verifier).
 * - token-hash (`?token_hash=&type=`): NIET direct afronden op GET (login-CSRF, linkscanners in mailprogramma's).
 *   De token gaat in een kortlevende httpOnly-cookie; de bevestigingspagina (zonder token in de URL) laat een
 *   server action pas na een klik verifiëren.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeAdminNext(url.searchParams.get("next"));
  if (tokenHash && isAllowedLinkType(type)) {
    const res = NextResponse.redirect(new URL("/beheer/link-bevestigen", url.origin));
    res.cookies.set(LINK_COOKIE, encodePendingLink({ tokenHash, type, next }), LINK_COOKIE_OPTIONS);
    return noReferrer(res);
  }
  const supabase = await createAuthClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return noReferrer(NextResponse.redirect(new URL(next, url.origin)));
  }
  return noReferrer(NextResponse.redirect(new URL("/beheer/login", url.origin)));
}
