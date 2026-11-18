import type { CatalogProduct } from "@/server/services/types";

export type ProductType = CatalogProduct["product_type"];

export type Category = {
  /** URL-deel onder /categorie/. */
  slug: string;
  /** Waarde van product_type in de catalogus. */
  type: ProductType;
  name: string;
  /** Korte inleiding; alleen feiten die ook in de productteksten staan. */
  intro: string;
};

/** SEO-vriendelijke categorieroutes, afgeleid van de producttypes in de catalogus. */
export const CATEGORIES: readonly Category[] = [
  {
    slug: "screenprotectors",
    type: "screenprotector",
    name: "Screenprotectors",
    intro: "Screenprotectors van 9H gehard glas voor je iPhone. Water- en olieafstotend.",
  },
  {
    slug: "privacy-screenprotectors",
    type: "privacy",
    name: "Privacy-screenprotectors",
    intro: "Screenprotectors van 9H gehard glas met privacyfilter: van opzij is je scherm slecht leesbaar.",
  },
  {
    slug: "hoesjes",
    type: "hoesje",
    name: "Hoesjes",
    intro: "Beschermhoesjes met MagSafe-ondersteuning voor je iPhone.",
  },
  {
    slug: "bundels",
    type: "bundel",
    name: "Bundels",
    intro: "Hoesje en screenprotectors samen voor een vaste prijs.",
  },
];

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function categoryByType(type: string): Category | undefined {
  return CATEGORIES.find((c) => c.type === type);
}

export function categoryPath(c: Category) {
  return `/categorie/${c.slug}`;
}
