/** Klantenservicepagina's onder /info/<slug>: titel en beschrijving (teksten staan in [page]/content.tsx). */
export const INFO_PAGES: Record<string, { title: string; description: string }> = {
  verzending: {
    title: "Verzending en levering",
    description: "Verzending met DHL of PostNL met track & trace, levertijden en verzendkosten van Timber Online.",
  },
  betalen: {
    title: "Betalen",
    description: "Veilig betalen bij Timber Online met iDEAL | Wero via de betaalpagina van Stripe.",
  },
  retourneren: {
    title: "Herroepen en retourneren",
    description: "Je hebt 14 dagen bedenktijd na ontvangst. Lees hoe je herroept, terugstuurt en je geld terugkrijgt.",
  },
  herroepingsformulier: {
    title: "Modelformulier voor herroeping",
    description: "Het wettelijke modelformulier om je bestelling bij Timber Online te herroepen.",
  },
  garantie: {
    title: "Garantie en klachten",
    description: "Je wettelijke garantie, hoe je een klacht meldt en hoe we klachten afhandelen.",
  },
  voorwaarden: {
    title: "Algemene voorwaarden",
    description: "Algemene voorwaarden voor bestellingen van consumenten bij Timber Online.",
  },
  privacy: {
    title: "Privacyverklaring",
    description: "Welke gegevens Timber Online verwerkt, waarvoor, met welke diensten en welke rechten je hebt.",
  },
  cookies: {
    title: "Cookies",
    description: "Timber Online gebruikt geen tracking- of advertentiecookies. Lees welke functionele opslag we gebruiken.",
  },
};

export const INFO_SLUGS = Object.keys(INFO_PAGES);

/** Links in de footer (het modelformulier staat op de retourpagina en bij herroepen). */
export const FOOTER_INFO_SLUGS = ["verzending", "betalen", "retourneren", "garantie", "voorwaarden", "privacy", "cookies"];
