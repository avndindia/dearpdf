import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grayscale PDF — Private PDF Tools",
  description: "Convert colourful PDF pages to grayscale locally in your browser.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
