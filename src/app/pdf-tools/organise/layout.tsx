import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Organise PDF Locally",
  description: "Reorder, rotate, and remove PDF pages visually in your browser without uploading the document.",
};

export default function OrganisePdfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
