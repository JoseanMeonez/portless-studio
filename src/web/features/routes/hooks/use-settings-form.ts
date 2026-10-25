import { useEffect, useState } from "react";
import type { ApiError } from "../../../../core/api/contract.ts";
import { parseConfig, type StudioConfig } from "../../../../core/config/studio-config.ts";
import { suggestName } from "../../../../core/ports/detected-port.ts";
import { parseNameTemplate } from "../../../../core/ports/name-template.ts";
import { projectIconKind } from "../../../../core/projects/project-icon.ts";
import { parsePort } from "../../../../core/routes/route-name.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage, PORT_MESSAGE } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type SettingsField = keyof StudioConfig;
export type FieldErrors = Partial<Record<SettingsField, string>>;

/** What the form edits: numbers stay text until saving, so half-typed values are allowed. */
type Draft = Omit<
  StudioConfig,
  "port" | "proxyPort" | "scanIntervalMs" | "ignoredPorts" | "autoRemoveAfterMinutes"
> & {
  port: string;
  proxyPort: string;
  scanSeconds: string;
  ignoredPorts: number[];
  autoRemoveMinutes: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; path: string };

const ICON_MESSAGE = "use an emoji, an http(s) URL or a data:image URL.";
const SECONDS_MESSAGE = "Use a number of seconds, 1 or more.";
const MINUTES_MESSAGE = "Use a whole number of minutes, 0 or more.";
const BLOCKED_MESSAGE =
  "The browser blocked notifications for this page. Allow them in the site settings, then try again.";
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
  "autoRemoveAfterMinutes",
  "desktopNotifications",
  "systemNotifications",
  "projectIcons",
  "nameTemplate",
  "checkForUpdates",
]);

/** A made-up project the name template preview renders. */
export const PREVIEW_PROJECT = {
  packageName: "@acme/web",
  repoName: "acme-monorepo",
  folderName: "web",
  worktreeName: "falcon",
  branch: "feat/ED-1234-add-login",
  port: 5173,
} as const;

export type NamePreview = { name: string | null; error: string | null };

/** What the template names the example project, or why the template is invalid. */
export function previewName(template: string): NamePreview {
  const parsed = parseNameTemplate(template.trim());
  if (!parsed.ok) return { name: null, error: `The template ${parsed.error}` };
  const { port, ...info } = PREVIEW_PROJECT;
  return { name: suggestName(info, template.trim(), port), error: null };
}

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
    const field: SettingsField =
      key === "scanSeconds"
        ? "scanIntervalMs"
        : key === "autoRemoveMinutes"
          ? "autoRemoveAfterMinutes"
          : key;
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

  /** An empty value removes the project's icon when saving. */
  const setProjectIcon = (project: string, value: string) => {
    if (draft) change("projectIcons", { ...draft.projectIcons, [project]: value });
  };

  /** Turning desktop notifications on first asks the browser for permission. */
  const setDesktopNotifications = async (value: boolean) => {
    if (!value) return change("desktopNotifications", false);
    const api = globalThis.Notification;
    if (!api) {
      return setErrors({ desktopNotifications: "This browser cannot show notifications." });
    }
    const permission =
      api.permission === "granted"
        ? "granted"
        : await api.requestPermission().catch(() => "denied");
    if (permission === "granted") change("desktopNotifications", true);
    else setErrors({ desktopNotifications: BLOCKED_MESSAGE });
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
    namePreview: draft ? previewName(draft.nameTemplate) : null,
    errors,
    formError,
    saving,
    change,
    addIgnoredPort,
    removeIgnoredPort,
    addIgnoredProcess,
    removeIgnoredProcess,
    setDesktopNotifications,
    setProjectIcon,
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
    autoRemoveMinutes: String(config.autoRemoveAfterMinutes),
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
  const minutes = Number(draft.autoRemoveMinutes.trim());
  if (draft.autoRemoveMinutes.trim() === "" || !Number.isInteger(minutes) || minutes < 0) {
    errors.autoRemoveAfterMinutes = MINUTES_MESSAGE;
  }
  for (const [project, icon] of Object.entries(draft.projectIcons)) {
    if (icon.trim() !== "" && projectIconKind(icon.trim()) === null) {
      errors.projectIcons = `The icon of ${project}: ${ICON_MESSAGE}`;
      break;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { scanSeconds: _seconds, autoRemoveMinutes: _minutes, ...rest } = draft;
  const parsed = parseConfig({
    ...rest,
    port: port.ok ? port.value : 0,
    proxyPort: proxyPort.ok ? proxyPort.value : 0,
    scanIntervalMs: Math.round(seconds * 1000),
    autoRemoveAfterMinutes: minutes,
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
