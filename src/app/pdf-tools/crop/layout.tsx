import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crop PDF — Private PDF Tools",
  description: "Crop selected PDF pages locally without rasterising them.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
