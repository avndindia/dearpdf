import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ToolClient from "@/components/ToolClient";
import { getTool, tools } from "@/lib/catalog";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return { title: "Tool" };
  return {
    title: tool.title,
    description: tool.description,
  };
}

export default async function ToolPage({ params }: Props) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();
  return <ToolClient tool={tool} />;
}
