import "server-only";
import { redirect } from "next/navigation";

export function back(path: string, msg: { ok?: string; fout?: string }): never {
  const qs = new URLSearchParams(Object.entries(msg).filter(([, v]) => v) as [string, string][]);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${qs.toString()}`);
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function errText(e: unknown) {
  const m = (e as Error)?.message ?? "Onbekende fout";
  const map: Record<string, string> = {
    actor_required: "Geen uitvoerder bekend",
    reason_required: "Reden is verplicht",
    bundle_needs_components: "Een bundel heeft minimaal één onderdeel nodig",
    carriers_required: "Kies minimaal één verzendmethode",
    return_qty_exceeds_order: "Retouraantal is hoger dan besteld",
    return_needs_lines: "Kies minimaal één artikel voor de retour",
    bol_title_fix_required: "Corrigeer eerst de bol-titel voordat je dit artikel op bol activeert",
    "Geen toegang voor deze rol": "Geen toegang voor deze rol",
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  if (/duplicate key.*sku/.test(m)) return "Deze SKU bestaat al";
  if (/duplicate key.*slug/.test(m)) return "Deze slug bestaat al";
  if (/duplicate key.*(ean|bol_reference|bol_offer_id)/.test(m)) return "Deze EAN, bol-referentie of offerId is al gekoppeld aan een ander artikel";
  if (/violates check constraint "products_preferred_allowed"/.test(m)) return "De voorkeursmethode moet ook toegestaan zijn";
  return m.slice(0, 200);
}
