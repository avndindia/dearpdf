import type { Metadata } from "next";
import { Inter } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DearPDF — private PDF tools in your browser",
    template: "%s · DearPDF",
  },
  description:
    "Drop a file. Get it back fixed. Nothing uploaded. Merge, compress, OCR, and more — 100% client-side.",
  metadataBase: new URL("https://dearpdf.in"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
