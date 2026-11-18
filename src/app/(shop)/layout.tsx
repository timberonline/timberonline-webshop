import Link from "next/link";
import { CartLink } from "@/components/cart-link";
import { CATEGORIES, categoryPath } from "@/components/categories";
import { SiteNav } from "@/components/site-nav";
import { INFO_PAGES } from "./info/pages";

export default function ShopLayout({ children }: LayoutProps<"/">) {
  const live = process.env.NEXT_PUBLIC_SHOP_MODE === "live";
  return (
    <>
      <a href="#inhoud" className="skip-link">
        Naar de inhoud
      </a>
      {!live && (
        <div className="testbar" role="note">
          Testomgeving: bestellingen worden niet geleverd en betalingen lopen via Stripe-testmodus.
        </div>
      )}
      <header className="site-header">
        <div className="container">
          <Link href="/" className="logo" aria-label="Timber Online, naar de startpagina">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/compact-light.svg" alt="" width="163" height="36" />
          </Link>
          <CartLink />
        </div>
      </header>
      <SiteNav />
      <main id="inhoud" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="container">
          <div className="footer-cols">
            <nav aria-labelledby="footer-assortiment">
              <h2 id="footer-assortiment" className="footer-title">
                Assortiment
              </h2>
              <ul>
                {CATEGORIES.map((c) => (
                  <li key={c.slug}>
                    <Link href={categoryPath(c)}>{c.name}</Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-labelledby="footer-klantenservice">
              <h2 id="footer-klantenservice" className="footer-title">
                Klantenservice
              </h2>
              <ul>
                <li>
                  <Link href="/contact">Contact</Link>
                </li>
                {Object.entries(INFO_PAGES).map(([slug, p]) => (
                  <li key={slug}>
                    <Link href={`/info/${slug}`}>{p.title}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <p className="small" style={{ margin: 0 }}>
            © {new Date().getFullYear()} Timber Online · Veilig betalen via Stripe
          </p>
        </div>
      </footer>
    </>
  );
}
