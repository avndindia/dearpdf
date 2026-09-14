import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scan to PDF",
  description: "Scan documents with your camera or gallery into a multi-page PDF — crop, enhance, private.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
