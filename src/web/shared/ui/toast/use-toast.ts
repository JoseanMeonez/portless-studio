import { useContext } from "react";
import { type ShowToast, ToastContext } from "./toast-context.ts";

/** Returns the function that shows a toast. Needs a `ToastProvider` above it. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a ToastProvider above it");
  return show;
}
