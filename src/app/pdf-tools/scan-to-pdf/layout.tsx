import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scan to PDF",
  description:
    "Live edge detection, auto-crop, Document or Book (2-page) mode, and continuous range scan — private, on-device.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
