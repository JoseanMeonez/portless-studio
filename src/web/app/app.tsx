import {
  RoutesDashboard,
  type RoutesGateway,
  RoutesGatewayProvider,
} from "../features/routes/index.ts";
import { ToastProvider } from "../shared/ui/toast/toast-provider.tsx";
import { useTheme } from "./use-theme.ts";

/** Root of the app. The gateway decides which backend the UI talks to. */
export function App({ gateway }: { gateway: RoutesGateway }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <RoutesGatewayProvider gateway={gateway}>
      <ToastProvider>
        <RoutesDashboard theme={theme} onToggleTheme={toggleTheme} />
      </ToastProvider>
    </RoutesGatewayProvider>
  );
}
