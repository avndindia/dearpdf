import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repair PDF — Private PDF Tools",
  description: "Rebuild a PDF's internal structure locally in your browser.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
