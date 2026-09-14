import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import PdfToolsOfflineRoot from "@/components/pdf-tools-offline-root";
import PdfToolCompletion from "@/components/pdf-tool-completion";
import OpenFilePicker from "@/components/OpenFilePicker";
import ToolChipBar from "@/components/ToolChipBar";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DearPDF — Private PDF tools in your browser",
    template: "%s · DearPDF",
  },
  description:
    "Drop a file. Get it back fixed. Nothing uploaded. Merge, compress, OCR, and more — private PDF tools that stay on your device.",
  metadataBase: new URL("https://dearpdf.in"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-canvas-bg font-sans text-on-surface antialiased selection:bg-primary-fixed selection:text-on-primary-fixed-variant">
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="flex-1 pt-16 sm:pt-20">{children}</main>
          <SiteFooter />
        </div>
        <PdfToolsOfflineRoot />
        <PdfToolCompletion />
        <ToolChipBar />
        <OpenFilePicker />
      </body>
    </html>
  );
}
