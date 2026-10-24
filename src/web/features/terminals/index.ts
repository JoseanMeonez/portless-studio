// Public API of the terminals feature. Other folders import from here only.

export type { TerminalFolder } from "./components/new-terminal-form.tsx";
export { TerminalPanelContainer } from "./containers/terminal-panel-container.tsx";
export { HttpTerminalsGateway } from "./data/http-terminals-gateway.ts";
export { InMemoryTerminalsGateway } from "./data/in-memory-terminals-gateway.ts";
export type { TerminalsGateway } from "./data/terminals-gateway.ts";
export { TerminalsGatewayProvider } from "./hooks/terminals-gateway-context.tsx";
export { type TerminalPanelController, useTerminalPanel } from "./hooks/use-terminal-panel.ts";
export type { TerminalEngine } from "./hooks/xterm-loader.ts";
