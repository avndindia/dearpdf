import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit PDF Metadata — Private PDF Tools",
  description: "Update PDF title, author, subject, and keywords locally.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
