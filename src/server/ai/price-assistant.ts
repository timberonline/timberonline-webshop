/**
 * AI-prijsassistent. Zet een opdracht in gewone taal om naar een concreet voorstel
 * (SKU, kanaal, huidige en nieuwe prijs). Er wordt niets toegepast zonder bevestiging;
 * toepassen loopt via dezelfde gecontroleerde functie als handmatig prijsbeheer (api_set_price).
 *
 * Provider "rule-based" is de testimplementatie (geen kosten, deterministisch).
 * Provider "openai" wordt alleen gebruikt als AI_PROVIDER=openai én OPENAI_API_KEY gezet is.
 */

export type AdminProduct = {
  id: string;
  sku: string;
  title: string;
  kind: "set" | "case" | "bundle";
  product_type: "screenprotector" | "privacy" | "hoesje" | "bundel";
  status: string;
  web_price_cents: number;
  bol_price_cents: number | null;
  bol_enabled: boolean;
  devices: { slug: string; name: string; confirmed: boolean }[];
};

export type ProposalItem = { product_id: string; sku: string; title: string; channel: "web" | "bol"; old_cents: number | null; new_cents: number };
export type ParseResult = { ok: true; items: ProposalItem[]; interpretation: string[] } | { ok: false; error: string };

type Change = { mode: "set"; cents: number } | { mode: "pct"; pct: number } | { mode: "delta"; cents: number };

const DEVICE_PATTERNS: { re: RegExp; slugs: string[]; family?: string }[] = [];
for (const n of [11, 12, 13, 14, 15]) {
  DEVICE_PATTERNS.push(
    { re: new RegExp(`iphone\\s*${n}\\s*pro\\s*max`, "i"), slugs: [`iphone-${n}-pro-max`] },
    { re: new RegExp(`iphone\\s*${n}\\s*plus`, "i"), slugs: [`iphone-${n}-plus`] },
    { re: new RegExp(`iphone\\s*${n}\\s*pro(?!\\s*max)`, "i"), slugs: [`iphone-${n}-pro`] },
    { re: new RegExp(`iphone\\s*${n}(?!\\s*(pro|plus|\\d))`, "i"), slugs: [`iphone-${n}`], family: `iPhone ${n}` },
  );
}

function euroToCents(s: string) {
  const m = s.replace(/\s/g, "").match(/^(\d{1,4})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export function parseChange(text: string): Change | null {
  const t = text.toLowerCase();
  const pct = t.match(/(\d{1,2})(?:[.,]\d+)?\s*%/);
  const down = /(verlaag|omlaag|korting|lager|goedkoper|minder)/.test(t);
  const up = /(verhoog|omhoog|hoger|duurder|meer)/.test(t);
  if (pct && (down || up)) return { mode: "pct", pct: (down ? -1 : 1) * Number(pct[1]) };
  const rel = t.match(/met\s*(?:€\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:euro|eur)?/);
  if (rel && (down || up) && !/\bop\s*€?\s*\d/.test(t)) {
    const c = euroToCents(rel[1]);
    if (c !== null) return { mode: "delta", cents: (down ? -1 : 1) * c };
  }
  const abs = t.match(/(?:op|naar|=)\s*€?\s*(\d{1,4}(?:[.,]\d{1,2})?)/) ?? t.match(/€\s*(\d{1,4}(?:[.,]\d{1,2})?)/);
  if (abs) {
    const c = euroToCents(abs[1]);
    if (c !== null) return { mode: "set", cents: c };
  }
  return null;
}

export function parseChannels(text: string): ("web" | "bol")[] | null {
  const t = text.toLowerCase();
  const web = /(webshop|website|web\b|eigen winkel)/.test(t);
  const bol = /\bbol(\.com)?\b/.test(t);
  if (/(beide kanalen|alle kanalen|overal)/.test(t) || (web && bol)) return ["web", "bol"];
  if (web) return ["web"];
  if (bol) return ["bol"];
  return null;
}

function apply(change: Change, old: number) {
  if (change.mode === "set") return change.cents;
  if (change.mode === "delta") return old + change.cents;
  return Math.round((old * (100 + change.pct)) / 100);
}

export function parsePricePrompt(prompt: string, products: AdminProduct[]): ParseResult {
  const text = prompt.trim();
  if (text.length < 5) return { ok: false, error: "Beschrijf welke prijs je wilt wijzigen." };
  const channels = parseChannels(text);
  if (!channels) return { ok: false, error: "Noem het kanaal: webshop, bol of beide." };
  const change = parseChange(text);
  if (!change) return { ok: false, error: "Noem de nieuwe prijs (bijv. ‘op €14,95’) of een wijziging (bijv. ‘verlaag met 10%’)." };

  const lower = text.toLowerCase();
  const interpretation: string[] = [];
  const all = /\balle\b/.test(lower);

  // toestellen
  let deviceSlugs: string[] | null = null;
  const matched = new Set<string>();
  let rest = lower;
  for (const p of DEVICE_PATTERNS) {
    if (p.re.test(rest)) {
      if (p.family && all) {
        for (const prod of products) for (const d of prod.devices) if (d.confirmed && (d.name === p.family || d.name.startsWith(p.family + " "))) matched.add(d.slug);
        interpretation.push(`‘alle ${p.family}’ gelezen als de hele ${p.family}-serie`);
      } else {
        p.slugs.forEach((s) => matched.add(s));
      }
      rest = rest.replace(p.re, " ");
    }
  }
  if (matched.size) deviceSlugs = [...matched];

  // producttype
  let types: AdminProduct["product_type"][] | null = null;
  if (/privacy/.test(lower)) types = ["privacy"];
  else if (/(normale|gewone|standaard)\s*(screen)?protector/.test(lower)) types = ["screenprotector"];
  else if (/(screen)?protector/.test(lower)) types = ["screenprotector", "privacy"];
  else if (/hoes/.test(lower)) types = ["hoesje"];
  else if (/bundel/.test(lower)) types = ["bundel"];
  const setsOnly = /sets?\b|tweepack/.test(lower);

  const skuMentions = [...text.matchAll(/\bTO-[A-Z0-9-]+\b/gi)].map((m) => m[0].toUpperCase());
  if (!deviceSlugs && !types && !all && skuMentions.length === 0) {
    return { ok: false, error: "Noem welke artikelen (bijv. ‘alle iPhone 15-privacysets’ of een SKU)." };
  }

  const selected = products.filter((p) => {
    if (p.status === "archived") return false;
    if (skuMentions.length) return skuMentions.includes(p.sku);
    if (types && !types.includes(p.product_type)) return false;
    if (setsOnly && p.kind !== "set") return false;
    if (deviceSlugs && !p.devices.some((d) => d.confirmed && deviceSlugs!.includes(d.slug))) return false;
    return true;
  });
  if (selected.length === 0) return { ok: false, error: "Geen artikelen gevonden die bij deze opdracht passen." };

  const items: ProposalItem[] = [];
  for (const p of selected) {
    for (const ch of channels) {
      if (ch === "bol" && p.kind === "bundle") continue;
      const old = ch === "web" ? p.web_price_cents : p.bol_price_cents;
      const next = apply(change, old ?? 0);
      if (next < 0 || next > 100000) return { ok: false, error: `Nieuwe prijs voor ${p.sku} valt buiten het toegestane bereik.` };
      items.push({ product_id: p.id, sku: p.sku, title: p.title, channel: ch, old_cents: old, new_cents: next });
    }
  }
  if (channels.includes("bol") && selected.some((p) => p.kind === "bundle")) interpretation.push("Bundels zijn alleen voor de webshop; bol overgeslagen.");
  return { ok: true, items, interpretation };
}

/** Optionele OpenAI-provider. Het model kiest SKU's; prijsberekening en validatie blijven hier. */
export async function parseWithOpenAI(prompt: string, products: AdminProduct[], opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): Promise<ParseResult> {
  const f = opts.fetchImpl ?? fetch;
  const catalog = products
    .filter((p) => p.status !== "archived")
    .map((p) => ({ sku: p.sku, title: p.title, type: p.product_type, kind: p.kind, devices: p.devices.filter((d) => d.confirmed).map((d) => d.name), web: p.web_price_cents, bol: p.bol_price_cents }));
  const res = await f("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Je zet prijsopdrachten om naar JSON {"items":[{"sku":string,"channel":"web"|"bol","new_cents":integer}],"notes":[string]} op basis van de catalogus. Verzin geen SKU\'s. Bundels alleen kanaal web. Bij twijfel: lege items en uitleg in notes.',
        },
        { role: "user", content: `Catalogus: ${JSON.stringify(catalog)}\n\nOpdracht: ${prompt}` },
      ],
    }),
  });
  if (!res.ok) return { ok: false, error: `AI-provider gaf HTTP ${res.status}` };
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  let parsed: { items?: { sku: string; channel: "web" | "bol"; new_cents: number }[]; notes?: string[] };
  try {
    parsed = JSON.parse(json.choices[0].message.content);
  } catch {
    return { ok: false, error: "AI-antwoord was geen geldige JSON" };
  }
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const items: ProposalItem[] = [];
  for (const it of parsed.items ?? []) {
    const p = bySku.get(it.sku);
    if (!p || !["web", "bol"].includes(it.channel) || !Number.isInteger(it.new_cents) || it.new_cents < 0 || it.new_cents > 100000) continue;
    if (it.channel === "bol" && p.kind === "bundle") continue;
    items.push({ product_id: p.id, sku: p.sku, title: p.title, channel: it.channel, old_cents: it.channel === "web" ? p.web_price_cents : p.bol_price_cents, new_cents: it.new_cents });
  }
  if (!items.length) return { ok: false, error: parsed.notes?.join(" ") || "Geen passende artikelen gevonden." };
  return { ok: true, items, interpretation: parsed.notes ?? [] };
}
