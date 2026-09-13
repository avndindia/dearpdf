import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF to Word Converter — Private PDF Tools",
  description: "Turn PDF text and scanned pages into an editable Word document locally in your browser.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
