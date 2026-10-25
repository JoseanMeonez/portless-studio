import { useMemo } from "react";
import type { ApiError, CreateAliasRequest } from "../../../../core/api/contract.ts";
import { directUrl } from "../../../../core/ports/direct-url.ts";
import type { Result } from "../../../../core/result.ts";
import type { Route } from "../../../../core/routes/route.ts";
import { copyText } from "../../../shared/lib/clipboard.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type RouteActions = {
  open: (route: Route) => void;
  copyUrl: (route: Route) => Promise<void>;
  copyCommand: (command: string) => Promise<void>;
  copyPath: (path: string) => Promise<void>;
  /** Copies any URL, e.g. the localhost one of a detected port. */
  copyLink: (url: string) => Promise<void>;
  /** Copies `http://localhost:<port>`, the address that skips the proxy. */
  copyDirectUrl: (port: number) => Promise<void>;
  /** Copies `KEY=url` lines for a `.env` file, one per line. */
  copyEnvLines: (lines: readonly string[]) => Promise<void>;
  openLink: (url: string) => void;
  /** Errors come back to the caller, which shows them next to the form fields. */
  createAlias: (request: CreateAliasRequest) => Promise<Result<null, ApiError>>;
  renameAlias: (route: Route, newName: string) => Promise<Result<null, ApiError>>;
  removeAlias: (route: Route) => Promise<void>;
};

/** What a person can do with routes, with the toasts that confirm each action. */
export function useRouteActions(): RouteActions {
  const gateway = useRoutesGateway();
  const toast = useToast();

  return useMemo<RouteActions>(() => {
    const copy = async (text: string, title: string) => {
      const copied = await copyText(text);
      toast(
        copied
          ? { title, description: text, tone: "success" }
          : { title: "Could not copy to the clipboard", description: text, tone: "error" },
      );
    };

    return {
      open: (route) => {
        window.open(route.url, "_blank", "noopener,noreferrer");
      },
      copyUrl: (route) => copy(route.url, "Copied URL"),
      copyCommand: (command) => copy(command, "Copied command"),
      copyPath: (path) => copy(path, "Copied path"),
      copyLink: (url) => copy(url, "Copied URL"),
      copyDirectUrl: (port) => copy(directUrl(port), "Copied direct URL"),
      copyEnvLines: (lines) =>
        copy(lines.join("\n"), lines.length === 1 ? "Copied .env line" : "Copied .env lines"),
      openLink: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      createAlias: async (request) => {
        const result = await gateway.createAlias(request);
        if (result.ok) {
          toast({
            title: `Named port ${request.port}`,
            description: `${request.name} now points to it.`,
            tone: "success",
          });
        }
        return result;
      },
      renameAlias: async (route, newName) => {
        const result = await gateway.renameAlias(route.name, { name: newName });
        if (result.ok) toast({ title: `Renamed ${route.name} to ${newName}`, tone: "success" });
        return result;
      },
      removeAlias: async (route) => {
        const result = await gateway.removeAlias(route.name);
        toast(
          result.ok
            ? {
                title: `Removed ${route.name}`,
                description: `Port ${route.port} no longer has this name.`,
                tone: "success",
              }
            : {
                title: `Could not remove ${route.name}`,
                description: apiErrorMessage(result.error),
                tone: "error",
              },
        );
      },
    };
  }, [gateway, toast]);
}
