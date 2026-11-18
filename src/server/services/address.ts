/** Splitst een adresregel ("Teststraat 12 A") in straat en huisnummer voor vervoerderslabels. */
export function splitStreet(line1: string | null | undefined, line2?: string | null) {
  const raw = (line1 ?? "").trim().replace(/\s+/g, " ");
  const m = raw.match(/^(.*?\D)\s*,?\s*(\d+[\s-]?[a-zA-Z0-9]{0,4}(?:[\s-]?(?:hs|bis|[a-zA-Z]|\d{1,3}))?)$/);
  if (m && m[1].trim().length > 1) {
    return { street: m[1].replace(/[,\s]+$/, "").trim(), house_number: m[2].trim(), address_extra: line2?.trim() || null };
  }
  // huisnummer staat soms op regel 2
  const n = (line2 ?? "").trim().match(/^(\d+[\s-]?[a-zA-Z0-9]{0,4})$/);
  if (raw && n) return { street: raw, house_number: n[1], address_extra: null };
  return { street: raw || null, house_number: null, address_extra: line2?.trim() || null };
}

export function normalizePostalCode(pc: string | null | undefined, country: string | null | undefined) {
  if (!pc) return null;
  const up = pc.toUpperCase().replace(/\s+/g, "");
  if ((country ?? "NL") === "NL" && /^\d{4}[A-Z]{2}$/.test(up)) return `${up.slice(0, 4)} ${up.slice(4)}`;
  return pc.trim().toUpperCase();
}
