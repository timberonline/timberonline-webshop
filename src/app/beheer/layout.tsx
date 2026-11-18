import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Beheer", template: "%s · Beheer Timber Online" }, robots: { index: false, follow: false } };

export default function BeheerRoot({ children }: LayoutProps<"/beheer">) {
  return children;
}
