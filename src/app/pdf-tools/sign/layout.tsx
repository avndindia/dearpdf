import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign PDF — Private PDF Tools",
  description: "Draw and place a signature on selected PDF pages locally.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
