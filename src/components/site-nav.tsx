"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORIES, categoryPath } from "./categories";

const LINKS = [...CATEGORIES.map((c) => ({ href: categoryPath(c), label: c.name })), { href: "/contact", label: "Contact" }];

/** Hoofdnavigatie van de winkel: categorieën en klantenservice. Op mobiel horizontaal scrollbaar. */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hoofdmenu" className="site-nav">
      <div className="container">
        <ul>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
