import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Summary of PDF",
  description:
    "Private on-device PDF summary in your browser. Nothing leaves this device — no cloud AI.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
