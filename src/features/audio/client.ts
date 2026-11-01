import { createJsonClient } from "../../data/jsonClient.ts";
import { audioManifestUrl } from "../../domain/audio/identity.ts";
import { validManifest } from "../../domain/audio/manifest.ts";

export const audioManifests = createJsonClient({
  url: audioManifestUrl,
  validate: validManifest,
  message: () => "تعذر تحميل التسجيل. تحقق من الاتصال وحاول مرة أخرى.",
});
