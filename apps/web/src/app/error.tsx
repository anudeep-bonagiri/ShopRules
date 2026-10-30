"use client";

import { useEffect } from "react";
import { PageError } from "@/components/stitch";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[shop-rules] route error", error);
  }, [error]);
  return <PageError title="Something broke on this page" subtitle="The rest of Shop Rules still works. Retry, or go back to the Watchlist." error={error.message || "Unknown error"} status={500} onRetry={reset} />;
}
