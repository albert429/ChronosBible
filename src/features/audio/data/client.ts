import { createJsonClient } from "../../../shared/network/jsonClient.ts";
import { audioManifestUrl } from "../domain/identity.ts";
import { validManifest } from "../domain/manifest.ts";

export const audioManifests = createJsonClient({
  url: audioManifestUrl,
  validate: validManifest,
  message: () => "تعذر تحميل التسجيل. تحقق من الاتصال وحاول مرة أخرى.",
});
