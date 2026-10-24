import { useEffect, useState } from "react";
import type { ApiError } from "../../../../core/api/contract.ts";
import { parseConfig, type StudioConfig } from "../../../../core/config/studio-config.ts";
import { parsePort } from "../../../../core/routes/route-name.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage, PORT_MESSAGE } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type SettingsField = keyof StudioConfig;
export type FieldErrors = Partial<Record<SettingsField, string>>;

/** What the form edits: numbers stay text until saving, so half-typed values are allowed. */
type Draft = Omit<StudioConfig, "port" | "proxyPort" | "scanIntervalMs" | "ignoredPorts"> & {
  port: string;
  proxyPort: string;
  scanSeconds: string;
  ignoredPorts: number[];
};

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; path: string };

const SECONDS_MESSAGE = "Use a number of seconds, 1 or more.";
const FIELDS = new Set<string>([
  "port",
  "autoName",
  "openBrowser",
  "registerStudioAlias",
  "startProxy",
  "proxyPort",
  "proxyHttps",
  "scanIntervalMs",
  "ignoredPorts",
  "ignoredProcesses",
]);

/** Loads the Studio config, edits a copy and saves it, with errors shown next to each field. */
export function useSettingsForm({ onSaved }: { onSaved: () => void }) {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void gateway.getConfig().then((result) => {
      if (!current) return;
      if (!result.ok) return setLoad({ status: "failed", message: apiErrorMessage(result.error) });
      setDraft(toDraft(result.value.config));
      setLoad({ status: "ready", path: result.value.path });
    });
    return () => {
      current = false;
    };
  }, [gateway]);

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    const field: SettingsField = key === "scanSeconds" ? "scanIntervalMs" : key;
    setErrors(({ [field]: _cleared, ...rest }) => rest);
    setFormError(null);
  };

  const addIgnoredPort = (value: string): string | null => {
    const port = parsePort(value);
    if (!port.ok) return `${PORT_MESSAGE.replace(/\.$/, "")}, like 9229.`;
    if (draft && !draft.ignoredPorts.includes(port.value)) {
      change(
        "ignoredPorts",
        [...draft.ignoredPorts, port.value].sort((a, b) => a - b),
      );
    }
    return null;
  };

  const addIgnoredProcess = (value: string): string | null => {
    if (
      draft &&
      !draft.ignoredProcesses.some((name) => name.toLowerCase() === value.toLowerCase())
    ) {
      change("ignoredProcesses", [...draft.ignoredProcesses, value]);
    }
    return null;
  };

  const removeIgnoredPort = (port: number) => {
    if (draft)
      change(
        "ignoredPorts",
        draft.ignoredPorts.filter((item) => item !== port),
      );
  };

  const removeIgnoredProcess = (name: string) => {
    if (draft)
      change(
        "ignoredProcesses",
        draft.ignoredProcesses.filter((item) => item !== name),
      );
  };

  const save = async () => {
    if (!draft) return;
    const checked = toConfig(draft);
    if (!checked.ok) return setErrors(checked.errors);
    setSaving(true);
    const result = await gateway.updateConfig(checked.config);
    setSaving(false);
    if (result.ok) {
      toast({ title: "Settings saved", tone: "success" });
      onSaved();
      return;
    }
    showServerError(result.error);
  };

  const showServerError = (error: ApiError) => {
    const field = error.error === "invalid_config" ? fieldNamedIn(error.message) : null;
    if (field) setErrors({ [field]: error.message });
    else setFormError(apiErrorMessage(error));
  };

  return {
    load,
    draft,
    errors,
    formError,
    saving,
    change,
    addIgnoredPort,
    removeIgnoredPort,
    addIgnoredProcess,
    removeIgnoredProcess,
    save,
  };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;

function toDraft(config: StudioConfig): Draft {
  return {
    ...config,
    port: String(config.port),
    proxyPort: String(config.proxyPort),
    scanSeconds: String(config.scanIntervalMs / 1000),
  };
}

/** Friendly messages for the two typed fields, then the same parser the server runs. */
function toConfig(
  draft: Draft,
): { ok: true; config: StudioConfig } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const port = parsePort(draft.port);
  if (!port.ok) errors.port = PORT_MESSAGE;
  const proxyPort = parsePort(draft.proxyPort);
  if (!proxyPort.ok) errors.proxyPort = PORT_MESSAGE;
  const seconds = Number(draft.scanSeconds.trim());
  if (draft.scanSeconds.trim() === "" || !Number.isFinite(seconds) || seconds < 1) {
    errors.scanIntervalMs = SECONDS_MESSAGE;
  }
  if (!port.ok || !proxyPort.ok || errors.scanIntervalMs) return { ok: false, errors };

  const { scanSeconds: _seconds, ...rest } = draft;
  const parsed = parseConfig({
    ...rest,
    port: port.value,
    proxyPort: proxyPort.value,
    scanIntervalMs: Math.round(seconds * 1000),
  });
  if (parsed.ok) return { ok: true, config: parsed.value };
  const field = fieldNamedIn(parsed.error);
  return { ok: false, errors: { [field ?? "port"]: parsed.error } };
}

/** `parseConfig` and the server quote the field they reject: `"port" must be ...`. */
function fieldNamedIn(message: string): SettingsField | null {
  const name = /"(\w+)"/.exec(message)?.[1];
  return name && FIELDS.has(name) ? (name as SettingsField) : null;
}
