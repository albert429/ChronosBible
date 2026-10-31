// The Cloudflare app build and deploy entry point. It stays at this path
// because wrangler.json's build command and the npm app:host:* scripts run
// `node scripts/cloudflare-app.mjs`; the implementation is
// scripts/hosting/cloudflare-app.mjs.
import { main } from "./hosting/cloudflare-app.mjs";

process.exitCode = main(process.argv.slice(2));
