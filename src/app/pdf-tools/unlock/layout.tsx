import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Remove Password from PDF — Private PDF Tools",
  description: "Remove a known PDF password locally and download a password-free copy.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
