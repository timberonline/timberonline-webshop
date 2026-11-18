import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth/supabase";

/** Rondt de PKCE-flow af (wachtwoord instellen/herstellen) en stuurt door naar een interne pagina. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/beheer";
  const safeNext = next.startsWith("/beheer") && !next.startsWith("//") ? next : "/beheer";
  const supabase = await createAuthClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/beheer/login", url.origin));
}
