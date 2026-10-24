import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app.tsx";
import { createGateway, createTerminalsGateway } from "./app/create-gateway.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing the #root element");

createRoot(root).render(
  <StrictMode>
    <App
      gateway={createGateway(window.location)}
      terminals={createTerminalsGateway(window.location)}
    />
  </StrictMode>,
);
