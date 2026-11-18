import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ADMIN = ["/beheer/login", "/beheer/auth", "/beheer/wachtwoord"];

/**
 * Ververst de Supabase-sessie en stuurt niet-ingelogde bezoekers van /beheer naar de login.
 * Dit is een optimistische controle; elke beheerpagina en -actie controleert zelf rol en MFA (requireAdmin).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && !PUBLIC_ADMIN.some((p) => path.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/beheer/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = { matcher: ["/beheer/:path*"] };
