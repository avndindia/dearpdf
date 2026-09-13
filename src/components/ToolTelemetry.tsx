"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { toolFromPath, trackToolEvent } from "@/lib/stats";

export default function ToolTelemetry() {
  const pathname = usePathname() || "";

  useEffect(() => {
    const tool = toolFromPath(pathname);
    if (tool) trackToolEvent(tool, "open");
  }, [pathname]);

  return null;
}
