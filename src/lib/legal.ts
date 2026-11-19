/**
 * Gedeelde juridische uitgangspunten voor de webshopteksten, e-mails en de herroepingsfunctie.
 *
 * Status: concept. De teksten volgen de wettelijke consumentenregels (Boek 6 en 7 BW; bronnen in docs/juridisch.md,
 * gecontroleerd op 19-11-2026). Beleidskeuzes waarvoor informatie of een besluit van de eigenaar ontbreekt, staan in POLICY_CHOICES en zijn
 * in de teksten gemarkeerd tot ze zijn vastgesteld.
 */

export const LEGAL_VERSION = "Concept 19 november 2026";
/** Zet op true zodra de eigenaar de teksten heeft vastgesteld (en alle beleidskeuzes zijn besloten). */
export const LEGAL_TEXTS_FINAL = false;

export type PolicyChoice = {
  id: string;
  topic: string;
  /** Wat de teksten nu als voorstel gebruiken. */
  proposal: string;
  /** Welke informatie of welk besluit ontbreekt. */
  open: string;
  decided: boolean;
};

export const POLICY_CHOICES: PolicyChoice[] = [
  {
    id: "return_costs",
    topic: "Kosten van terugzenden",
    proposal: "De directe kosten van het terugzenden zijn voor rekening van de klant.",
    open: "Besluit: klant betaalt retourkosten, of de webshop vergoedt ze (bijv. met een retourlabel).",
    decided: false,
  },
  {
    id: "applied_protector",
    topic: "Aangebrachte screenprotector bij herroeping",
    proposal: "Een aangebrachte (gebruikte) screenprotector kan niet opnieuw worden verkocht; de waardevermindering wordt verrekend, tot maximaal het aankoopbedrag.",
    open: "Besluit of en hoe waardevermindering wordt verrekend.",
    decided: false,
  },
  {
    id: "shipping_costs",
    topic: "Verzendkosten en levergebied",
    proposal: "Verzendkosten zoals ingesteld in beheer (nu gratis); levering in Nederland en België.",
    open: "Definitieve verzendtarieven en of België in het levergebied blijft (Belgisch consumentenrecht, Nederlandstalige teksten).",
    decided: false,
  },
  {
    id: "vat",
    topic: "Btw op prijzen",
    proposal: "Alle prijzen zijn inclusief btw.",
    open: "Bevestiging van de btw-positie (btw-plichtig of kleineondernemersregeling); bij KOR vermelden dat geen btw wordt berekend.",
    decided: false,
  },
  {
    id: "adr",
    topic: "Geschillenbeslechting",
    proposal: "Klachten via de klantenservice; geen aansluiting bij een geschilleninstantie; de klant kan naar de rechter.",
    open: "Besluit over aansluiting bij een geschilleninstantie of keurmerk (bijv. via Thuiswinkel of WebwinkelKeur).",
    decided: false,
  },
  {
    id: "warranty",
    topic: "Garantie",
    proposal: "Alleen de wettelijke garantie (conformiteit); geen aanvullende commerciële garantie.",
    open: "Besluit over een eventuele extra garantie of fabrieksgarantie per product.",
    decided: false,
  },
  {
    id: "product_safety",
    topic: "Productveiligheid (GPSR)",
    proposal: "Fabrikant en veiligheidsinformatie per product worden nog toegevoegd.",
    open: "Naam en adres van fabrikant/importeur en eventuele waarschuwingen per product (Verordening (EU) 2023/988, art. 19).",
    decided: false,
  },
  {
    id: "retention",
    topic: "Bewaartermijnen",
    proposal: "Orders en betaalgegevens 7 jaar (fiscale bewaarplicht); contactberichten en herroepingen 2 jaar na afhandeling; labels 1 jaar.",
    open: "Bevestiging van de niet-fiscale bewaartermijnen en inrichting van periodiek verwijderen.",
    decided: false,
  },
  {
    id: "processors",
    topic: "Verwerkersovereenkomsten",
    proposal: "Gebruikte diensten: Vercel, Supabase, Stripe, Resend; later DHL/PostNL en bol.",
    open: "Verwerkersovereenkomsten (DPA's) accepteren of vastleggen en doorgifte buiten de EU per dienst controleren.",
    decided: false,
  },
  {
    id: "payment_methods",
    topic: "Betaalmethoden en betalen na levering",
    proposal: "iDEAL | Wero en de andere methoden die Stripe op de betaalpagina toont; wie niet vooruit wil betalen, neemt contact op.",
    open:
      "Volgens de ACM moet naast volledige vooruitbetaling ook een mogelijkheid zijn om minstens de helft na levering te betalen (art. 7:26 lid 2 BW); alleen iDEAL is onvoldoende. Besluit: achteraf betalen aanbieden (bijv. Klarna via Stripe; valt vanaf 20-11-2026 onder de herziene consumentenkredietrichtlijn: neutraal tonen, niet aanprijzen) of een andere regeling.",
    decided: false,
  },
  {
    id: "guarantee_notice",
    topic: "Geharmoniseerde kennisgeving wettelijke garantie",
    proposal: "De wettelijke garantie wordt in tekst uitgelegd.",
    open: "De geharmoniseerde EU-kennisgeving over de wettelijke garantie toevoegen (art. 6:230m lid 1 onder l BW) volgens het officiële model.",
    decided: false,
  },
  {
    id: "processing_register",
    topic: "Register van verwerkingen",
    proposal: "Nog geen register.",
    open: "Register van verwerkingsactiviteiten opstellen (art. 30 AVG; volgens de AP is een webshop zelden een incidentele verwerking).",
    decided: false,
  },
];

export const OPEN_POLICY_CHOICES = POLICY_CHOICES.filter((c) => !c.decided);

export function policy(id: string) {
  const c = POLICY_CHOICES.find((x) => x.id === id);
  if (!c) throw new Error(`Onbekende beleidskeuze: ${id}`);
  return c;
}

/** Bedenktijd in dagen (art. 6:230o BW). */
export const WITHDRAWAL_DAYS = 14;

/**
 * Teksten van de online herroepingsfunctie: art. 6:230oa BW (Stb. 2026, 153; in werking juni 2026), omzetting van art. 11 bis
 * Richtlijn 2011/83/EU zoals ingevoegd door Richtlijn (EU) 2023/2673. De labels volgen de Nederlandse richtlijntekst.
 */
export const WITHDRAWAL_LABELS = {
  /** Toegang tot de functie (link/knop), doorlopend zichtbaar tijdens de bedenktijd. */
  entry: "Hier de overeenkomst herroepen",
  /** Bevestigingsknop. */
  confirm: "Herroeping bevestigen",
} as const;

export const WITHDRAWAL_PATH = "/herroepen";

type Seller = { shop_name?: string | null; legal_name?: string | null; email?: string | null; phone?: string | null };
type Addr = { name?: string | null; street?: string | null; house_number?: string | null; postal_code?: string | null; city?: string | null };

/**
 * Modelformulier voor herroeping (Bijlage I, deel B, Richtlijn 2011/83/EU; in Nederland de bijlage bij art. 6:230m lid 1
 * onder h BW), ingevuld met de gegevens van de verkoper.
 */
export function modelWithdrawalForm(seller: Seller, ret: Addr) {
  const addressee = [
    seller.shop_name && seller.legal_name && seller.shop_name !== seller.legal_name ? `${seller.shop_name} (${seller.legal_name})` : seller.shop_name ?? seller.legal_name ?? "Timber Online",
    [ret.street, ret.house_number].filter(Boolean).join(" "),
    [ret.postal_code, ret.city].filter(Boolean).join(" "),
    seller.email ? `E-mail: ${seller.email}` : null,
  ].filter(Boolean);
  return {
    intro: "(dit formulier alleen invullen en terugzenden wanneer u de overeenkomst wilt herroepen)",
    to: addressee,
    lines: [
      "Ik/Wij* deel/delen* u hierbij mede, dat ik/wij* onze overeenkomst betreffende de verkoop van de volgende goederen/levering van de volgende dienst* herroep/herroepen*:",
      "Besteld op*/ontvangen op*:",
      "Naam consument(en):",
      "Adres consument(en):",
      "Handtekening van consument(en) (alleen wanneer dit formulier op papier wordt ingediend):",
      "Datum:",
    ],
    footnote: "(*) Doorhalen wat niet van toepassing is.",
  };
}
