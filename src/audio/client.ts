import { createJsonClient } from "../lib/jsonClient.ts";
import { audioManifestUrl, validManifest } from "./manifest.ts";

export const audioManifests = createJsonClient({
  url: audioManifestUrl,
  validate: validManifest,
  message: () => "تعذر تحميل التسجيل. تحقق من الاتصال وحاول مرة أخرى.",
});
