import { createContext } from "react";

export type ToastTone = "neutral" | "success" | "error";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

export type Toast = Required<Pick<ToastInput, "title" | "tone">> & {
  id: number;
  description: string | null;
};

export type ShowToast = (toast: ToastInput) => void;

export const ToastContext = createContext<ShowToast | null>(null);
