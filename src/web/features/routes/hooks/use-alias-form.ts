import { useState } from "react";
import type { ApiError } from "../../../../core/api/contract.ts";
import type { Result } from "../../../../core/result.ts";
import { type ProxyStatus, routeUrl } from "../../../../core/routes/route.ts";
import { parsePort, parseRouteName } from "../../../../core/routes/route-name.ts";
import { apiErrorMessage, nameErrorMessage, PORT_MESSAGE } from "./route-messages.ts";

export type AliasFormValues = { name: string; port: number; force: boolean };

type AliasFormOptions = {
  mode: "create" | "rename";
  initialName?: string;
  initialPort?: number;
  proxy: ProxyStatus;
  submit: (values: AliasFormValues) => Promise<Result<null, ApiError>>;
  onDone: () => void;
};

/** State and validation of the "Name a port" and "Rename" form, checked as the person types. */
export function useAliasForm({
  mode,
  initialName = "",
  initialPort,
  proxy,
  submit,
  onDone,
}: AliasFormOptions) {
  const [name, setNameValue] = useState(initialName);
  const [port, setPortValue] = useState(initialPort === undefined ? "" : String(initialPort));
  const [touched, setTouched] = useState({ name: false, port: false });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Set when the name is taken; the form then offers to replace the route that has it.
  const [conflict, setConflict] = useState<string | null>(null);

  const parsedName = parseRouteName(name);
  const parsedPort = parsePort(port);
  const showNameError = touched.name || name.trim() !== "";
  const showPortError = touched.port || port.trim() !== "";
  const nameError = !parsedName.ok && showNameError ? nameErrorMessage(parsedName.error) : null;
  const portError = !parsedPort.ok && showPortError ? PORT_MESSAGE : null;
  const unchanged = mode === "rename" && parsedName.ok && parsedName.value === initialName;
  const canSubmit = parsedName.ok && parsedPort.ok && !submitting && !unchanged;
  const tld = proxy.tlds[0] ?? "localhost";
  const previewUrl = parsedName.ok ? routeUrl(`${parsedName.value}.${tld}`, proxy) : null;

  const resetFeedback = () => {
    setServerError(null);
    setConflict(null);
  };

  const send = async (force: boolean) => {
    if (!parsedName.ok || !parsedPort.ok) {
      setTouched({ name: true, port: true });
      return;
    }
    setSubmitting(true);
    resetFeedback();
    const result = await submit({ name: parsedName.value, port: parsedPort.value, force });
    setSubmitting(false);
    if (result.ok) return onDone();
    if (result.error.error === "name_taken" && mode === "create")
      setConflict(apiErrorMessage(result.error));
    else setServerError(apiErrorMessage(result.error));
  };

  return {
    name,
    port,
    nameError,
    portError,
    serverError,
    conflict,
    submitting,
    canSubmit,
    previewUrl,
    setName: (value: string) => {
      setNameValue(value);
      resetFeedback();
    },
    setPort: (value: string) => {
      setPortValue(value);
      resetFeedback();
    },
    touchName: () => setTouched((current) => ({ ...current, name: true })),
    touchPort: () => setTouched((current) => ({ ...current, port: true })),
    submit: () => send(false),
    replace: () => send(true),
  };
}

export type AliasForm = ReturnType<typeof useAliasForm>;
