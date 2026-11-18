import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { siteUrl } from "@/components/seo";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  // Basis voor canonieke en Open Graph-URL's (APP_URL met terugval, zie siteUrl).
  metadataBase: siteUrl(),
  title: { default: "Timber Online", template: "%s · Timber Online" },
  description: "Screenprotectors en hoesjes voor iPhone. Snel verzonden, veilig betalen.",
  applicationName: "Timber Online",
  openGraph: { siteName: "Timber Online", locale: "nl_NL", type: "website" },
};

export const viewport: Viewport = { themeColor: "#0F2937", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
