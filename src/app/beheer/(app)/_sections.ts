import "server-only";
import { mayAccess, type AdminArea, type Role } from "@/server/auth/admin";

/**
 * Beheeronderdelen en het rolgebied waaronder ze vallen. Bepaalt alleen wat het menu en links tonen;
 * elke page.tsx dwingt zelf af met requireAdminPage(ROLES.<area>) (gecontroleerd in tests/unit/admin-guards.test.ts).
 */
export const ADMIN_SECTIONS: { href: string; label: string; area: AdminArea }[] = [
  { href: "/beheer", label: "Overzicht", area: "shipping" },
  { href: "/beheer/orders", label: "Orders", area: "orders" },
  { href: "/beheer/herroepingen", label: "Herroepingen", area: "orders" },
  { href: "/beheer/verzendingen", label: "Verzendingen", area: "shipping" },
  { href: "/beheer/artikelen", label: "Artikelen en prijzen", area: "catalog" },
  { href: "/beheer/voorraad", label: "Voorraad", area: "catalog" },
  { href: "/beheer/acties", label: "Acties", area: "catalog" },
  { href: "/beheer/bol", label: "bol-koppeling", area: "catalog" },
  { href: "/beheer/prijsassistent", label: "Prijsassistent", area: "catalog" },
  { href: "/beheer/audit", label: "Logboek", area: "audit" },
  { href: "/beheer/instellingen", label: "Instellingen", area: "settings" },
];

/** Onderdeel waar een beheerpad onder valt (langste match; /beheer zelf alleen exact). */
export function sectionFor(href: string) {
  const path = href.split(/[?#]/)[0];
  return ADMIN_SECTIONS.filter((s) => path === s.href || (s.href !== "/beheer" && path.startsWith(`${s.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
}

/** Mag deze rol de beheerpagina achter deze link openen? Onbekende paden: nee. */
export function mayOpen(role: Role, href: string): boolean {
  const s = sectionFor(href);
  return !!s && mayAccess(role, s.area);
}

/** Menu-items voor een rol. */
export function navItemsFor(role: Role) {
  return ADMIN_SECTIONS.filter((s) => mayAccess(role, s.area)).map(({ href, label }) => ({ href, label }));
}
