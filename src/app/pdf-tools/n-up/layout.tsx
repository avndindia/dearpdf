import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Multiple Pages Per Sheet",
  description: "Put 2, 4, 6, 9 or 16 PDF pages on one sheet with margins, gaps and optional borders — private, in-browser.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
