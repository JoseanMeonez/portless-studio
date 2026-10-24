import { createContext } from "react";

export type ToastTone = "neutral" | "success" | "error";

/** A button on the toast; clicking it also closes the toast. */
export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
};

export type Toast = Required<Pick<ToastInput, "title" | "tone">> & {
  id: number;
  description: string | null;
  action: ToastAction | null;
};

export type ShowToast = (toast: ToastInput) => void;

export const ToastContext = createContext<ShowToast | null>(null);
