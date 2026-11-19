import Link from "next/link";
import { CartLink } from "@/components/cart-link";
import { CATEGORIES, categoryPath } from "@/components/categories";
import { SiteNav } from "@/components/site-nav";
import { getPublicBusiness } from "@/server/queries/business";
import { addressLine, sellerName, telHref } from "@/server/services/business";
import { WITHDRAWAL_LABELS, WITHDRAWAL_PATH } from "@/lib/legal";
import { FOOTER_INFO_SLUGS, INFO_PAGES } from "./info/pages";

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const live = process.env.NEXT_PUBLIC_SHOP_MODE === "live";
  const b = (await getPublicBusiness())?.business;
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
                <li>
                  <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link>
                </li>
                {FOOTER_INFO_SLUGS.map((slug) => (
                  <li key={slug}>
                    <Link href={`/info/${slug}`}>{INFO_PAGES[slug].title}</Link>
                  </li>
                ))}
              </ul>
            </nav>
            {b ? (
              <section aria-labelledby="footer-bedrijf">
                <h2 id="footer-bedrijf" className="footer-title">
                  {b.shop_name ?? "Timber Online"}
                </h2>
                <address className="footer-address">
                  {b.legal_name && b.legal_name !== b.shop_name ? <>Een webshop van {b.legal_name}<br /></> : null}
                  {addressLine(b) ? <>{addressLine(b)}<br /></> : null}
                  {b.email ? <><a href={`mailto:${b.email}`}>{b.email}</a><br /></> : null}
                  {b.phone ? <><a href={telHref(b.phone)}>{b.phone}</a><br /></> : null}
                  {b.kvk ? <>KvK {b.kvk}</> : null}
                  {b.kvk && b.vat_id ? " · " : null}
                  {b.vat_id ? <>Btw-id {b.vat_id}</> : null}
                </address>
              </section>
            ) : null}
          </div>
          <p className="small" style={{ margin: 0 }}>
            © {new Date().getFullYear()} {sellerName(b)} · Veilig betalen via Stripe · Prijzen in euro
          </p>
        </div>
      </footer>
    </>
  );
}
