"use server";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/server/auth/supabase";
import { isAllowedLinkType, safeAdminNext } from "../auth/link";

/**
 * Verifieert een uitnodigings- of herstellink pas na een bewuste klik (server action: Next controleert de Origin,
 * dus een andere site kan dit formulier niet namens de bezoeker indienen).
 */
export async function confirmLinkAction(fd: FormData) {
  const tokenHash = String(fd.get("token_hash") ?? "");
  const type = String(fd.get("type") ?? "");
  const next = safeAdminNext(String(fd.get("next") ?? ""));
  const supabase = await createAuthClient();
  if (!supabase || !tokenHash || !isAllowedLinkType(type)) redirect("/beheer/login");
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) redirect("/beheer/login");
  redirect(next);
}
