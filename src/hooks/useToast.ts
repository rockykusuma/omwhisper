import { useState, useCallback } from "react";

const DEFAULT_DURATION_MS = 2500;

export function useToast(duration = DEFAULT_DURATION_MS) {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      setTimeout(() => setToast(null), duration);
    },
    [duration]
  );

  return { toast, showToast };
}
