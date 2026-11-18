import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Timber Online", template: "%s · Timber Online" },
  description: "Screenprotectors en hoesjes voor iPhone. Snel verzonden, veilig betalen.",
  applicationName: "Timber Online",
};

export const viewport: Viewport = { themeColor: "#0F2937", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
