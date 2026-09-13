import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Add Password to PDF — Private PDF Tools",
  description: "Add a password to a PDF locally with 256-bit encryption.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
