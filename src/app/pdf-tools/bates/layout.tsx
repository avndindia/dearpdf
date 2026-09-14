import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bates Numbering",
  description: "Stamp continuous Bates numbers across multiple PDFs with a production log — entirely on this device.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
