import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import PdfToolsOfflineRoot from "@/components/pdf-tools-offline-root";
import PdfToolCompletion from "@/components/pdf-tool-completion";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DearPDF — Fast, Private, In-Browser PDF Suite",
    template: "%s · DearPDF",
  },
  description:
    "Drop a file. Get it back fixed. Nothing uploaded. Merge, compress, OCR, and more — 100% client-side WebAssembly.",
  metadataBase: new URL("https://dearpdf.in"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-surface font-sans text-on-surface antialiased selection:bg-primary-fixed selection:text-on-primary-fixed-variant">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1 pt-14">{children}</main>
          <SiteFooter />
        </div>
        <PdfToolsOfflineRoot />
        <PdfToolCompletion />
      </body>
    </html>
  );
}
