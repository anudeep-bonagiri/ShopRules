import type { Metadata } from "next";
import "@shopify/polaris/build/esm/styles.css";
import "./globals.css";
import { AppFrame } from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "Shop Rules",
  description: "Watches tariffs, product safety rules, and state sales-tax thresholds that touch your products, verifies every alert against the official source, and drafts the reprice or compliance step.",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
  openGraph: { title: "Shop Rules", description: "Tariffs, product safety, and sales tax for Etsy, Shopify, and Amazon sellers, verified against the official source.", images: [{ url: "/logo.png", width: 787, height: 244, alt: "Shop Rules" }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
