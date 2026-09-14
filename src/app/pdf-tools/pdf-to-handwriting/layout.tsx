import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF to Handwriting",
  description: "Turn PDF text into notebook-style handwritten notes on this device — nothing uploaded.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
