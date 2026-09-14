import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flatten PDF — Private PDF Tools",
  description: "Bake PDF forms, annotations, and visible edits into fixed page images locally.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
