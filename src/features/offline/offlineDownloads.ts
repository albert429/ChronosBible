/**
 * This device's download queue (downloadQueue.ts), created on first use,
 * and the installed app's automatic first download.
 */
import { useSyncExternalStore } from "react";
import { currentConnection } from "../../shared/browser/network";
import { savePack, savedCount } from "./downloads";
import { packUrls, type Pack } from "./packs";
import { downloadQueue, PACK_ORDER, type DownloadQueue } from "./downloadQueue";

let queue: DownloadQueue | undefined;
const downloads = () =>
  (queue ??= downloadQueue({ list: packUrls, savedCount, save: savePack }));

/** "off" once the reader stopped a download: never restarted on its own. */
const AUTO_KEY = "chronos-offline-auto";
function setAuto(value: "on" | "off") {
  try {
    localStorage.setItem(AUTO_KEY, value);
  } catch {
    /* Storage blocked: the choice lasts for this visit only. */
  }
}
function autoAllowed() {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return false;
  }
}

/** Save these packs (all by default), Scripture text first. */
export function saveOffline(packs: readonly Pack[] = PACK_ORDER) {
  setAuto("on");
  return downloads().save(packs);
}

/** Stop saving; the installed app will not restart it by itself. */
export function stopSaving() {
  setAuto("off");
  downloads().cancel();
}

/**
 * The installed app keeps everything for reading offline without being
 * asked: Scripture text, then study notes, in the background. Each launch
 * resumes what is missing (a new build's changed files too), unless the
 * reader stopped it or asked the browser to save data.
 */
export function autoSave() {
  if (!autoAllowed() || currentConnection()?.saveData) return;
  void downloads().save(PACK_ORDER);
}

/** The queue's state, for the menu's button and the offline panel. */
export function useOfflineDownloads() {
  const current = downloads();
  return useSyncExternalStore(current.subscribe, current.get);
}
