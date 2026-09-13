import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flatten PDF Forms — Private PDF Tools",
  description: "Flatten completed PDF form fields locally into fixed page content.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
