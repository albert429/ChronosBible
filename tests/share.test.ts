import { test } from "node:test";
import assert from "node:assert/strict";
import { appShareData } from "../src/navigation/share.ts";
import { APP_INFO } from "../src/appInfo.ts";

test("Share data is the app title and description with the page address, never its query or hash", () => {
  Object.assign(globalThis, {
    location: {
      origin: "https://app.example",
      pathname: "/reader/",
      search: "?day=5",
      hash: "#passage-1",
    },
  });
  const data = appShareData();
  assert.deepEqual(Object.keys(data).sort(), ["text", "title", "url"]);
  assert.equal(data.title, APP_INFO.title);
  assert.equal(data.url, "https://app.example/reader/");
  assert.match(
    data.text ?? "",
    /بالترتيب المعتاد.*بالترتيب الزمني.*تسجيل صوتي/,
  );
});
