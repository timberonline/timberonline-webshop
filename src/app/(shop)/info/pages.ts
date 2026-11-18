/** Klantenservicepagina's onder /info/<slug>: titel en beschrijving (teksten staan in [page]/page.tsx). */
export const INFO_PAGES: Record<string, { title: string; description: string }> = {
  verzending: {
    title: "Verzending",
    description: "Verzending binnen Nederland en België met DHL of PostNL, met track & trace per e-mail.",
  },
  retourneren: {
    title: "Retourneren",
    description: "Je hebt 14 dagen bedenktijd na ontvangst. Lees hoe retourneren werkt.",
  },
  voorwaarden: {
    title: "Algemene voorwaarden",
    description: "Algemene voorwaarden van Timber Online.",
  },
  privacy: {
    title: "Privacy",
    description: "Hoe Timber Online omgaat met je gegevens.",
  },
};

export const INFO_SLUGS = Object.keys(INFO_PAGES);
