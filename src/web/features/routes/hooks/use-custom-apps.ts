import { useCallback, useEffect, useState } from "react";
import type { CustomApp } from "../../../../core/projects/custom-app.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type CustomAppsForm = {
  /** Null while loading. */
  apps: CustomApp[] | null;
  error: string | null;
  status: "idle" | "saving" | "saved";
  change: (index: number, field: keyof CustomApp, value: string) => void;
  add: () => void;
  remove: (index: number) => void;
  save: () => Promise<void>;
};

/** The open-with apps added in Settings, edited as a draft and saved on their own. */
export function useCustomApps(): CustomAppsForm {
  const gateway = useRoutesGateway();
  const [apps, setApps] = useState<CustomApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CustomAppsForm["status"]>("idle");

  useEffect(() => {
    let current = true;
    void gateway.getCustomApps().then((result) => {
      if (!current) return;
      if (result.ok) setApps(result.value.apps);
      else {
        setApps([]);
        setError(apiErrorMessage(result.error));
      }
    });
    return () => {
      current = false;
    };
  }, [gateway]);

  const edit = useCallback((update: (draft: CustomApp[]) => CustomApp[]) => {
    setApps((draft) => (draft === null ? draft : update(draft)));
    setStatus("idle");
  }, []);

  const save = useCallback(async () => {
    if (apps === null) return;
    setStatus("saving");
    const result = await gateway.updateCustomApps(apps);
    if (result.ok) {
      setApps(result.value.apps);
      setError(null);
      setStatus("saved");
    } else {
      setError(apiErrorMessage(result.error));
      setStatus("idle");
    }
  }, [apps, gateway]);

  return {
    apps,
    error,
    status,
    change: (index, field, value) =>
      edit((draft) => draft.map((app, at) => (at === index ? { ...app, [field]: value } : app))),
    add: () => edit((draft) => [...draft, { name: "", command: "" }]),
    remove: (index) => edit((draft) => draft.filter((_app, at) => at !== index)),
    save,
  };
}
