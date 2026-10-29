import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAppearance } from "./navigation/appearance";
import { afterStartup } from "./lib/afterStartup";

initAppearance();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Offline support loads apart from the reader, once the page has settled.
afterStartup(
  () =>
    void import("./pwa/register").then(
      (module) => module.registerServiceWorker(),
      () => {},
    ),
);
