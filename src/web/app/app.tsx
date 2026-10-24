import { useState } from "react";
import { type RoutesGateway, RoutesGatewayProvider } from "../features/routes/index.ts";
import {
  InMemoryTerminalsGateway,
  type TerminalEngine,
  type TerminalsGateway,
  TerminalsGatewayProvider,
} from "../features/terminals/index.ts";
import { ToastProvider } from "../shared/ui/toast/toast-provider.tsx";
import { StudioLayout } from "./studio-layout.tsx";
import { useTheme } from "./use-theme.ts";

type AppProps = {
  gateway: RoutesGateway;
  /** Terminals backend; an empty in-memory one when omitted. */
  terminals?: TerminalsGateway;
  /** Replaced in tests, which cannot run xterm.js. */
  loadTerminalEngine?: () => Promise<TerminalEngine>;
};

/** Root of the app. The gateways decide which backend the UI talks to. */
export function App({ gateway, terminals, loadTerminalEngine }: AppProps) {
  const { theme, toggleTheme } = useTheme();
  const [fallbackTerminals] = useState(() => new InMemoryTerminalsGateway());
  return (
    <RoutesGatewayProvider gateway={gateway}>
      <TerminalsGatewayProvider gateway={terminals ?? fallbackTerminals}>
        <ToastProvider>
          <StudioLayout
            theme={theme}
            onToggleTheme={toggleTheme}
            loadTerminalEngine={loadTerminalEngine}
          />
        </ToastProvider>
      </TerminalsGatewayProvider>
    </RoutesGatewayProvider>
  );
}
