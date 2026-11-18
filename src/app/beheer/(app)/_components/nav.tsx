"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Toont alleen de onderdelen die de rol mag openen; de lijst wordt server-side gefilterd (zie _sections.ts). */
export function AdminNav({ items, who, role, devBypass }: { items: { href: string; label: string }[]; who: string; role: string; devBypass: boolean }) {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Beheer">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/compact-dark.svg" alt="Timber Online beheer" width="136" height="30" />
      </div>
      <ul>
        {items.map((i) => {
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
