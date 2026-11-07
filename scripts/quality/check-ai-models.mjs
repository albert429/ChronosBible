// Checks the configured AI models against OpenRouter's public model list:
// each must still exist and be free. Prints any announced expiry date.
// Usage: npm run ai:models [-- --mode <mode>]
import { MODELS as models } from "../../worker/models.ts";

const response = await fetch("https://openrouter.ai/api/v1/models", {
  headers: { Accept: "application/json" },
});
if (!response.ok) {
  console.error(`OpenRouter model list: HTTP ${response.status}`);
  process.exit(1);
}
const { data } = await response.json();
const byId = new Map(data.map((model) => [model.id, model]));
const free = (pricing = {}) =>
  ["prompt", "completion", "request"].every(
    (field) => pricing[field] === undefined || Number(pricing[field]) === 0,
  );

let failed = false;
for (const id of models) {
  const model = byId.get(id);
  if (!model) {
    console.error(`✗ ${id}: not listed (renamed or removed)`);
    failed = true;
    continue;
  }
  if (!free(model.pricing)) {
    console.error(`✗ ${id}: no longer free (${JSON.stringify(model.pricing)})`);
    failed = true;
    continue;
  }
  const expiry = model.expiration_date
    ? `, expires ${model.expiration_date}`
    : "";
  console.log(`✓ ${id}: free, context ${model.context_length}${expiry}`);
}
process.exit(failed ? 1 : 0);
