import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Add Page Numbers to PDF — Private PDF Tools",
  description: "Number selected PDF pages locally with custom placement and formatting.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
