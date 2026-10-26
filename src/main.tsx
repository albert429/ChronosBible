import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAppearance } from "./navigation/appearance";

initAppearance();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Offline support loads after the page, apart from the reader, and registers
// its worker once idle.
addEventListener(
  "load",
  () =>
    void import("./pwa/register").then(
      (module) => module.registerServiceWorker(),
      () => {},
    ),
  { once: true },
);
