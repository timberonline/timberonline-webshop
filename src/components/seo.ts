/**
 * Gedeelde Open Graph-velden. Een pagina die `openGraph` zet, vervangt die van de root-layout volledig;
 * spreid deze standaardwaarden daarom in elke pagina-specifieke openGraph.
 */
export const OG_DEFAULTS = { siteName: "Timber Online", locale: "nl_NL", type: "website" } as const;

/** Beschrijving inkorten tot een lengte die zoekmachines volledig tonen. */
export function clampDescription(text: string, max = 160) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

/**
 * Publieke basis-URL van de winkel: APP_URL, anders het productiedomein of de deployment-URL op Vercel,
 * anders localhost. Een ongeldige waarde valt terug op de volgende kandidaat in plaats van de app te laten crashen.
 */
export function siteUrl(source: Record<string, string | undefined> = process.env): URL {
  const host = (v: string | undefined) => (v?.trim() ? `https://${v.trim()}` : undefined);
  const candidates = [source.APP_URL?.trim(), host(source.VERCEL_PROJECT_PRODUCTION_URL), host(source.VERCEL_URL), "http://localhost:3000"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const url = new URL(c);
      if (url.protocol === "https:" || url.protocol === "http:") return url;
    } catch {
      // volgende kandidaat
    }
  }
  return new URL("http://localhost:3000");
}

/** Absolute URL voor een pad op de winkel (sitemap, robots). */
export function absoluteUrl(path: string, base: URL = siteUrl()) {
  return new URL(path, base).toString();
}
