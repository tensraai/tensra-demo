import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Tensra – CRM → ERP Integration Demo",
  description:
    "A simulated HubSpot deal is automatically converted into an ERP sales order, with validation, field mapping, two-way sync and failure recovery.",
  other: { google: "notranslate" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" translate="no">
      <body className="notranslate">{children}</body>
    </html>
  );
}