"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/server/auth/supabase";
import { decodePendingLink, LINK_COOKIE } from "../auth/link";

/**
 * Verifieert een uitnodigings- of herstellink pas na een bewuste klik. De token komt uit de httpOnly-cookie die de
 * callback zette (niet uit het formulier); Next controleert bij server actions bovendien de Origin.
 */
export async function confirmLinkAction() {
  const store = await cookies();
  const pending = decodePendingLink(store.get(LINK_COOKIE)?.value);
  store.delete({ name: LINK_COOKIE, path: "/beheer" }); // eenmalig, ook bij een fout
  const supabase = await createAuthClient();
  if (!pending || !supabase) redirect("/beheer/login");
  const { error } = await supabase.auth.verifyOtp({ token_hash: pending.tokenHash, type: pending.type });
  if (error) redirect("/beheer/login");
  redirect(pending.next);
}
