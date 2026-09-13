import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compress PDF Locally",
  description: "Reduce PDF size, or split a large PDF into parts under a chosen limit, entirely in your browser.",
};

export default function CompressPdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
