"use client";

import { ErrorScreen } from "@/ui/shell/error-screen";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <ErrorScreen reset={reset} />;
}
