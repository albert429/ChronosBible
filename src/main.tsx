import "./shared/styles/tokens.css";
import "./shared/styles/base.css";
import "./shared/styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { initAppearance } from "./features/appearance/appearance";
import { afterStartup } from "./shared/browser/afterStartup";

initAppearance();
// Chromium offers installation once, often before offline support loads:
// keep the offer for the menu's «تثبيت التطبيق» (src/features/offline/register.ts).
addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  (globalThis as { __installPrompt?: Event }).__installPrompt = event;
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Offline support loads apart from the reader, once the page has settled.
afterStartup(
  () =>
    void import("./features/offline/register").then(
      (module) => module.registerServiceWorker(),
      () => {},
    ),
);
