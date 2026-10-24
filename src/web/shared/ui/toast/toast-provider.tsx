import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type ShowToast, type Toast, ToastContext } from "./toast-context.ts";
import { Toaster } from "./toaster.tsx";

const VISIBLE_FOR_MS = 4000;
const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    ({ title, description, tone = "neutral", action }) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        title,
        tone,
        description: description ?? null,
        action: action ?? null,
      };
      setToasts((current) => [...current, toast].slice(-MAX_TOASTS));
      timers.current.set(
        id,
        // A toast with a button stays a little longer, so there is time to reach it.
        setTimeout(() => dismiss(id), action ? VISIBLE_FOR_MS * 2 : VISIBLE_FOR_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}
