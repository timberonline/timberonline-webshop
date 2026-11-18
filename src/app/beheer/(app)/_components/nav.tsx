"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/beheer", label: "Overzicht" },
  { href: "/beheer/orders", label: "Orders" },
  { href: "/beheer/verzendingen", label: "Verzendingen" },
  { href: "/beheer/artikelen", label: "Artikelen en prijzen" },
  { href: "/beheer/voorraad", label: "Voorraad" },
  { href: "/beheer/acties", label: "Acties" },
  { href: "/beheer/bol", label: "bol-koppeling" },
  { href: "/beheer/prijsassistent", label: "Prijsassistent" },
  { href: "/beheer/audit", label: "Logboek" },
  { href: "/beheer/instellingen", label: "Instellingen" },
];

export function AdminNav({ who, role, devBypass }: { who: string; role: string; devBypass: boolean }) {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Beheer">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/compact-dark.svg" alt="Timber Online beheer" width="136" height="30" />
      </div>
      <ul>
        {ITEMS.map((i) => {
          const current = i.href === "/beheer" ? path === "/beheer" : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={current ? "page" : undefined}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="who">
        {devBypass ? <strong style={{ color: "#fde68a" }}>Lokale ontwikkelmodus zonder login</strong> : null}
        <div>{who}</div>
        <div>{role}</div>
        {!devBypass ? (
          <form action="/beheer/uitloggen" method="post">
            <button className="link-btn" style={{ color: "#fff", minHeight: 44 }}>
              Uitloggen
            </button>
          </form>
        ) : null}
      </div>
    </nav>
  );
}
