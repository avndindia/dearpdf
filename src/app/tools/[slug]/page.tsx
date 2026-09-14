import LegacyToolRedirectClient from "./redirect-client";

const SLUG_MAP: Record<string, string> = {
  merge: "/pdf-tools/merge",
  split: "/pdf-tools/split",
  organise: "/pdf-tools/organise",
  "page-numbers": "/pdf-tools/page-numbers",
  crop: "/pdf-tools/crop",
  compress: "/pdf-tools/compress",
  "compress-split": "/pdf-tools/compress?split=1",
  grayscale: "/pdf-tools/grayscale",
  edit: "/pdf-tools/edit",
  watermark: "/pdf-tools/watermark",
  metadata: "/pdf-tools/metadata",
  flatten: "/pdf-tools/flatten",
  sign: "/pdf-tools/sign",
  "images-to-pdf": "/pdf-tools/images-to-pdf",
  "pdf-to-images": "/pdf-tools/pdf-to-images",
  "pdf-to-word": "/pdf-tools/pdf-to-word",
  ocr: "/pdf-tools/pdf-to-text",
  "pdf-to-text": "/pdf-tools/pdf-to-text",
  "add-password": "/pdf-tools/lock",
  lock: "/pdf-tools/lock",
  "remove-password": "/pdf-tools/unlock",
  unlock: "/pdf-tools/unlock",
  repair: "/pdf-tools/repair",
  "searchable-pdf": "/pdf-tools/pdf-to-text",
};

export function generateStaticParams() {
  return Object.keys(SLUG_MAP).map((slug) => ({ slug }));
}

export default async function LegacyToolRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const target = SLUG_MAP[slug] ?? "/#tools";
  return <LegacyToolRedirectClient target={target} />;
}
