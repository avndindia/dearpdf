import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scan to PDF",
  description: "Scan pages with your camera, then download a PDF. Continuous range scan on your phone — private, on-device.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
