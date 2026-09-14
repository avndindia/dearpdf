import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rotate PDF",
  description: "Rotate selected or all PDF pages by 90° steps in your browser — nothing uploaded.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
