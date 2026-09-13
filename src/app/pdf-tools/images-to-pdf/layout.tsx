import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Images to PDF Locally",
  description: "Combine JPG, PNG, and WebP images into one PDF locally in your browser.",
};

export default function ImagesToPdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
