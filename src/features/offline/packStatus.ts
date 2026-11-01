/**
 * The state of one pack's row in the offline panel: listing and counting
 * its files, saving them and cancelling. The device (enumeration, cache,
 * downloads) is passed in, so the flow is tested without a browser.
 */
import type { Pack } from "./packs.ts";

export type PackStatus =
  | { kind: "checking" }
  | { kind: "ready"; saved: number; total: number }
  | { kind: "saving"; saved: number; total: number }
  | { kind: "error"; message: string };

export const CHECK_FAILED = "تعذر التحقق من الملفات. تحقق من الاتصال.";
export const SAVE_FAILED = "توقف الحفظ. تحقق من الاتصال وحاول مرة أخرى.";

export type PackDevice = {
  list(pack: Pack, signal: AbortSignal): Promise<string[]>;
  savedCount(urls: readonly string[]): Promise<number>;
  save(
    urls: readonly string[],
    progress: (saved: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
};

/** Every file of the pack is kept on this device. */
export const isComplete = (status: PackStatus) =>
  status.kind === "ready" && status.total > 0 && status.saved === status.total;

/**
 * Start checking a pack and return its actions. Nothing is shown once the
 * row is closed: closing stops the check's inventory request and any save.
 */
export function packController(
  pack: Pack,
  device: PackDevice,
  show: (status: PackStatus) => void,
) {
  const closed = new AbortController();
  const display = (status: PackStatus) => {
    if (!closed.signal.aborted) show(status);
  };
  let urls: string[] = [];
  let saving: AbortController | undefined;
  device
    .list(pack, closed.signal)
    .then(async (list) => {
      urls = list;
      const saved = await device.savedCount(list);
      display({ kind: "ready", saved, total: list.length });
    })
    .catch(() => display({ kind: "error", message: CHECK_FAILED }));
  return {
    /** Save the files not kept yet; resolves once saved, cancelled or failed. */
    async save() {
      const controller = new AbortController();
      saving = controller;
      const total = urls.length;
      try {
        await device.save(
          urls,
          (saved) => display({ kind: "saving", saved, total }),
          controller.signal,
        );
        display({ kind: "ready", saved: total, total });
      } catch {
        const saved = await device.savedCount(urls).catch(() => 0);
        display(
          controller.signal.aborted
            ? { kind: "ready", saved, total }
            : { kind: "error", message: SAVE_FAILED },
        );
      }
    },
    cancel: () => saving?.abort(),
    close() {
      closed.abort();
      saving?.abort();
    },
  };
}
