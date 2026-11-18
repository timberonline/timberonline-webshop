import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "../db";
import { env } from "../env";
import { createAuthClient } from "./supabase";

export type Role = "owner" | "admin" | "fulfilment";
export type AdminSession = { userId: string; email: string; role: Role; actor: string; devBypass: boolean };

export const ROLE_LABEL: Record<Role, string> = { owner: "Eigenaar", admin: "Beheerder", fulfilment: "Verzending" };

export class ForbiddenError extends Error {
  constructor() {
    super("Geen toegang voor deze rol");
  }
}

/**
 * Stelt vast wie de beheerder is. Vereist: geldige Supabase-sessie, MFA (aal2) en een actieve rij in admin_users.
 * Retourneert null als de gebruiker niet is ingelogd of nog MFA moet doen (status geeft aan welke).
 */
export async function getAdminSession(): Promise<{ status: "ok"; session: AdminSession } | { status: "login" | "mfa" | "forbidden" | "unconfigured" }> {
  await connection(); // beheer is altijd per verzoek; nooit statisch voorgerenderd
  if (env.adminDevBypass()) {
    return { status: "ok", session: { userId: "00000000-0000-0000-0000-000000000000", email: "lokaal@dev", role: "owner", actor: "admin:lokaal-dev", devBypass: true } };
  }
  const supabase = await createAuthClient();
  if (!supabase) return { status: "unconfigured" };
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return { status: "login" };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { status: "mfa" };
  const admin = await getDb().rpc<{ user_id: string; email: string; role: Role } | null>("api_admin_lookup", { user_id: userData.user.id });
  if (!admin) return { status: "forbidden" };
  return { status: "ok", session: { userId: admin.user_id, email: admin.email, role: admin.role, actor: `admin:${admin.email}`, devBypass: false } };
}

/** Voor pagina's: stuurt door naar login/MFA of toont geen toegang. */
export async function requireAdminPage(roles?: Role[]): Promise<AdminSession> {
  const res = await getAdminSession();
  if (res.status === "login" || res.status === "unconfigured") redirect("/beheer/login");
  if (res.status === "mfa") redirect("/beheer/mfa");
  if (res.status !== "ok") redirect("/beheer/geen-toegang");
  if (roles && !roles.includes(res.session.role)) redirect("/beheer/geen-toegang");
  return res.session;
}

/** Voor server actions en route handlers: gooit een fout zonder geldige beheersessie. */
export async function requireAdmin(roles?: Role[]): Promise<AdminSession> {
  const res = await getAdminSession();
  if (res.status !== "ok") throw new ForbiddenError();
  if (roles && !roles.includes(res.session.role)) throw new ForbiddenError();
  return res.session;
}

export const ROLES = {
  catalog: ["owner", "admin"] as Role[],
  orders: ["owner", "admin"] as Role[],
  shipping: ["owner", "admin", "fulfilment"] as Role[],
  settings: ["owner"] as Role[],
};
