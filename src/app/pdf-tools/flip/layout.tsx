import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flip PDF",
  description: "Flip PDF pages horizontally or vertically on this device — nothing uploaded.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
