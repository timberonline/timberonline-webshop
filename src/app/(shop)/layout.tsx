import Link from "next/link";
import { CartLink } from "@/components/cart-link";

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
      <main id="inhoud" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="container">
          <nav aria-label="Informatie">
            <Link href="/info/verzending">Verzending</Link>
            <Link href="/info/retourneren">Retourneren</Link>
            <Link href="/info/voorwaarden">Algemene voorwaarden</Link>
            <Link href="/info/privacy">Privacy</Link>
          </nav>
          <p className="small" style={{ margin: 0 }}>
            © {new Date().getFullYear()} Timber Online · Veilig betalen via Stripe
          </p>
        </div>
      </footer>
    </>
  );
}
