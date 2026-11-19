import { z } from "zod";
import type { Db } from "../db/types";

/** Bedrijfsgegevens achter de webshop (instelling business_info). */
export type BusinessInfo = {
  legal_name: string;
  shop_name: string;
  street: string | null;
  house_number: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  kvk: string | null;
  vat_id: string | null;
  phone: string | null;
  email: string | null;
};

/** Adres voor een toepassing (afzender op labels, retouradres). */
export type PostalAddress = {
  name: string;
  street: string | null;
  house_number: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
};

/** Bevestiging door de eigenaar vóór de commerciële livegang. */
export type Confirmation = { confirmed_at?: string | null; confirmed_by?: string | null };

/** Vaste kopie bij een order (orders.seller): gegevens zoals ze golden toen de order werd aangemaakt. */
export type SellerSnapshot = { business: Partial<BusinessInfo>; return_address: Partial<PostalAddress>; captured_at?: string; backfilled?: boolean };

export type PublicBusiness = { business: Partial<BusinessInfo>; return_address: Partial<PostalAddress> };

export const COUNTRY_NAME: Record<string, string> = { NL: "Nederland", BE: "België" };

/** "Abel Tasmanstraat 22" */
export function streetLine(a: { street?: string | null; house_number?: string | null }) {
  return [a.street, a.house_number].filter(Boolean).join(" ");
}

/** "6413 SX Heerlen" */
export function cityLine(a: { postal_code?: string | null; city?: string | null }) {
  return [a.postal_code, a.city].filter(Boolean).join(" ");
}

/** "Abel Tasmanstraat 22, 6413 SX Heerlen, Nederland" (land optioneel). */
export function addressLine(a: { street?: string | null; house_number?: string | null; postal_code?: string | null; city?: string | null; country?: string | null }, withCountry = false) {
  return [streetLine(a), cityLine(a), withCountry && a.country ? COUNTRY_NAME[a.country] ?? a.country : null].filter(Boolean).join(", ");
}

export function addressComplete(a: Partial<PostalAddress> | null | undefined) {
  return Boolean(a && a.name && a.street && a.house_number && a.postal_code && a.city);
}

/** Webshopnaam en onderneming: "Timber Online (Timber Services)". */
export function sellerName(b: Partial<BusinessInfo> | null | undefined) {
  const shop = b?.shop_name || "Timber Online";
  return b?.legal_name && b.legal_name !== shop ? `${shop} (${b.legal_name})` : shop;
}

/** Telefoonnummer voor een tel:-link: "+31617028248". */
export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).transform((v) => (v === "" ? null : v));

export const BusinessSchema = z.object({
  legal_name: text(120).min(1, "Vul de naam van de onderneming in"),
  shop_name: text(80).min(1, "Vul de webshopnaam in"),
  street: optional(120),
  house_number: optional(20),
  postal_code: optional(12),
  city: optional(80),
  country: z.enum(["NL", "BE"]),
  kvk: optional(8).refine((v) => v === null || /^\d{8}$/.test(v), "KvK-nummer heeft 8 cijfers"),
  vat_id: optional(20).refine((v) => v === null || /^NL\d{9}B\d{2}$/.test(v.replace(/\s/g, "").toUpperCase()), "Btw-identificatienummer heeft de vorm NL000000000B00"),
  phone: optional(30).refine((v) => v === null || /^\+?[\d\s()-]{8,}$/.test(v), "Ongeldig telefoonnummer"),
  email: optional(160).refine((v) => v === null || z.email().safeParse(v).success, "Ongeldig e-mailadres"),
});

export const AddressSchema = z.object({
  name: text(120).min(1, "Vul een naam in"),
  street: optional(120),
  house_number: optional(20),
  postal_code: optional(12),
  city: optional(80),
  country: z.enum(["NL", "BE"]),
});

const POSTCODE: Record<string, RegExp> = { NL: /^\d{4} ?[A-Z]{2}$/i, BE: /^\d{4}$/ };

/** Ontbrekende of ongeldige adresonderdelen (leeg = volledig). */
export function addressMissing(a: Partial<PostalAddress> | null | undefined): string[] {
  const out: string[] = [];
  if (!a?.name) out.push("naam");
  if (!a?.street) out.push("straat");
  if (!a?.house_number) out.push("huisnummer");
  if (!a?.postal_code || !(POSTCODE[a.country ?? "NL"] ?? /./).test(a.postal_code)) out.push("postcode");
  if (!a?.city) out.push("plaats");
  return out;
}

/** Wat ontbreekt er aan de bedrijfsgegevens voor de wettelijke vermelding (art. 3:15d en 6:230m BW)? */
export function businessMissing(b: Partial<BusinessInfo> | null | undefined): string[] {
  const out = addressMissing(b ? { ...b, name: b.legal_name ?? "" } : null).filter((x) => x !== "naam");
  if (!b?.legal_name) out.unshift("onderneming");
  if (!b?.kvk) out.push("KvK-nummer");
  if (!b?.vat_id) out.push("btw-identificatienummer");
  if (!b?.phone) out.push("telefoon");
  if (!b?.email) out.push("e-mail");
  return out;
}

export async function loadPublicBusiness(db: Db): Promise<PublicBusiness | null> {
  try {
    return await db.rpc<PublicBusiness>("api_public_business", {});
  } catch (e) {
    console.error("Bedrijfsgegevens laden mislukt:", (e as Error).message);
    return null;
  }
}

export type LaunchItem = { key: string; label: string; done: boolean; detail?: string; href?: string };

/** Punten die de eigenaar vóór de commerciële livegang moet bevestigen (zichtbaar in beheer). */
export function launchChecklist(settings: Record<string, unknown>, opts: { legalTextsFinal: boolean; openPolicyChoices: number }): LaunchItem[] {
  const conf = (key: string) => {
    const v = settings[key] as (Confirmation & Record<string, unknown>) | undefined;
    if (!v?.confirmed_at) return false;
    // alleen bevestigd als de gegevens ook volledig zijn
    return key === "business_info" ? businessMissing(v as Partial<BusinessInfo>).length === 0 : addressMissing(v as Partial<PostalAddress>).length === 0;
  };
  return [
    { key: "business_info", label: "Bedrijfsgegevens controleren en bevestigen", done: conf("business_info"), href: "/beheer/instellingen#bedrijf" },
    { key: "sender_address", label: "Afzenderadres op labels bevestigen", done: conf("sender_address"), href: "/beheer/instellingen#afzender" },
    { key: "return_address", label: "Retouradres bevestigen", done: conf("return_address"), href: "/beheer/instellingen#retour" },
    {
      key: "legal_texts",
      label: "Verkoop- en privacyteksten vaststellen",
      done: opts.legalTextsFinal && opts.openPolicyChoices === 0,
      detail: opts.openPolicyChoices ? `${opts.openPolicyChoices} beleidskeuze(s) open` : undefined,
    },
  ];
}
