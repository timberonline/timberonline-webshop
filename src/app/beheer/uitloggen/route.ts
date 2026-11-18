import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/auth/supabase";

export async function POST(request: Request) {
  const supabase = await createAuthClient();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/beheer/login", request.url), { status: 303 });
}
