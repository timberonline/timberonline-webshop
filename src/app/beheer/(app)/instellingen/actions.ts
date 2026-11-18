"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { parseEuroToCents } from "@/lib/format";
import { getCtx } from "@/server/services/runtime";
import { processBolQueue } from "@/server/services/bol-sync";
import { back, errText, str } from "../_lib";

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
    await save("sender_address", {
      name: str(fd, "s_name") || "Timber Online",
      street: str(fd, "s_street") || null,
      house_number: str(fd, "s_house_number") || null,
      postal_code: str(fd, "s_postal_code") || null,
      city: str(fd, "s_city") || null,
      country: "NL",
    });
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
