import { browserConfig } from "./playwright.shared.ts";

// The AI bundle test also inspects dist/ from the app fixture build.
export default browserConfig("ai");
