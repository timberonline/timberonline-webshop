"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { parseEuroToCents } from "@/lib/format";
import { getCtx } from "@/server/services/runtime";
import { processBolQueue } from "@/server/services/bol-sync";
import { AddressSchema, BusinessSchema, type Confirmation } from "@/server/services/business";
import { back, errText, str } from "../_lib";

type Fields = Record<string, unknown>;

/** Leest een groep velden met prefix (b_, s_, r_) en valideert die. */
function group<T>(fd: FormData, prefix: string, keys: string[], schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, what: string): T {
  const raw: Fields = {};
  for (const k of keys) raw[k] = str(fd, `${prefix}${k}`);
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error(`${what}: ${r.error.issues[0]?.message ?? "ongeldige invoer"}`);
  return r.data;
}

/**
 * Bevestiging vóór livegang: blijft staan zolang het vinkje aan blijft en de gegevens niet wijzigen; bij een wijziging
 * met vinkje aan wordt opnieuw (nu) bevestigd; zonder vinkje vervalt de bevestiging.
 */
function confirmation(prev: (Fields & Confirmation) | undefined, next: Fields, checked: boolean, actor: string): Confirmation {
  if (!checked) return { confirmed_at: null, confirmed_by: null };
  const strip = (v: Fields | undefined) => JSON.stringify(Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => !["confirmed_at", "confirmed_by", "source"].includes(k)).sort()));
  if (prev?.confirmed_at && strip(prev) === strip(next)) return { confirmed_at: prev.confirmed_at, confirmed_by: prev.confirmed_by ?? null };
  return { confirmed_at: new Date().toISOString(), confirmed_by: actor };
}

const ADDRESS_KEYS = ["name", "street", "house_number", "postal_code", "city", "country"];
const BUSINESS_KEYS = ["legal_name", "shop_name", "street", "house_number", "postal_code", "city", "country", "kvk", "vat_id", "phone", "email"];

export async function saveSettingsAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.settings);
    const db = getCtx().db;
    const save = (key: string, value: unknown) => db.rpc("api_setting_save", { actor: s.actor, key, value });
    const buffer = Number(str(fd, "bol_buffer_units"));
    const minutes = Number(str(fd, "reservation_minutes"));
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 20) throw new Error("Buffer moet tussen 0 en 20 liggen");
    if (!Number.isInteger(minutes) || minutes < 31 || minutes > 120) throw new Error("Reserveringstijd moet tussen 31 en 120 minuten liggen (Stripe-sessie duurt 30 minuten)");
    await save("bol_buffer_units", buffer);
    await save("reservation_minutes", minutes);
    await save("delivery_promise", str(fd, "delivery_promise"));
    await save("tracking_info", str(fd, "tracking_info"));
    await save("bol_requires_tracking", fd.get("bol_requires_tracking") === "on");
    const letterMax = Number(str(fd, "letter_max_weight_g"));
    if (!Number.isInteger(letterMax) || letterMax < 20 || letterMax > 2000) throw new Error("Gewichtsgrens briefpost moet tussen 20 en 2000 gram liggen");
    await save("letter_max_weight_g", letterMax);
    // Bedrijfsgegevens, afzender- en retouradres: elk apart aanpasbaar en apart te bevestigen vóór livegang.
    const current = await db.rpc<Record<string, Fields & Confirmation>>("api_admin_settings", {});
    const business = group(fd, "b_", BUSINESS_KEYS, BusinessSchema, "Bedrijfsgegevens");
    if (business.vat_id) business.vat_id = business.vat_id.replace(/\s/g, "").toUpperCase();
    const sender = group(fd, "s_", ADDRESS_KEYS, AddressSchema, "Afzenderadres");
    const ret = group(fd, "r_", ADDRESS_KEYS, AddressSchema, "Retouradres");
    const withSource = { ...business, source: current.business_info?.source ?? null };
    await save("business_info", { ...withSource, ...confirmation(current.business_info, withSource, fd.get("b_confirmed") === "on", s.actor) });
    await save("sender_address", { ...sender, ...confirmation(current.sender_address, sender, fd.get("s_confirmed") === "on", s.actor) });
    await save("return_address", { ...ret, ...confirmation(current.return_address, ret, fd.get("r_confirmed") === "on", s.actor) });
    const options = ["tracked", "letter"].map((code) => {
      const cost = parseEuroToCents(str(fd, `${code}_cost`) || "0");
      const freeFrom = str(fd, `${code}_free_from`) ? parseEuroToCents(str(fd, `${code}_free_from`)) : null;
      if (cost === null) throw new Error("Ongeldige verzendkosten");
      return {
        code,
        label: str(fd, `${code}_label`),
        description: str(fd, `${code}_description`),
        cost_cents: cost,
        free_from_cents: freeFrom,
        carriers: code === "tracked" ? ["dhl", "postnl"] : ["letter"],
        tracking: code === "tracked",
        enabled: fd.get(`${code}_enabled`) === "on",
        delivery: str(fd, `${code}_delivery`),
      };
    });
    if (!options.some((o) => o.enabled)) throw new Error("Minimaal één verzendoptie moet aan staan");
    await save("shipping_options", options);
    await processBolQueue(getCtx()).catch(() => undefined);
    msg = { ok: "Instellingen opgeslagen" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/instellingen");
  revalidatePath("/", "layout");
  back("/beheer/instellingen", msg);
}

export async function saveAdminAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.settings);
    const userId = str(fd, "user_id");
    if (userId === s.userId && str(fd, "role") !== "owner") throw new Error("Je kunt je eigen eigenaarsrol niet verlagen");
    await getCtx().db.rpc("api_admin_upsert", { actor: s.actor, user_id: userId, email: str(fd, "email"), role: str(fd, "role"), active: fd.get("active") === "on" });
    msg = { ok: "Beheerder opgeslagen" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/instellingen");
  back("/beheer/instellingen", msg);
}
