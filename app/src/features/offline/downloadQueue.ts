/**
 * The device's offline downloads as one queue, shared by the menu's
 * download button, the offline panel's rows and the installed app's first
 * download: one pack at a time, Scripture text before study notes. Saving
 * goes on after the menu closes. The device is passed in, so the order,
 * cancelling and retries are tested without a browser.
 */
import type { Pack } from "./packs.ts";
import {
  isComplete,
  packController,
  type PackDevice,
  type PackStatus,
} from "./packStatus.ts";

/** Scripture first: it is what a reader needs offline before anything else. */
export const PACK_ORDER: readonly Pack[] = ["text", "study"];

export type Downloads = {
  packs: Record<Pack, PackStatus>;
  /** The pack being saved now. */
  active?: Pack;
  /** Packs waiting their turn, in order. */
  queued: readonly Pack[];
};

const CHECKING: PackStatus = { kind: "checking" };

/** Every pack is kept on this device. */
export const allSaved = (downloads: Downloads) =>
  PACK_ORDER.every((pack) => isComplete(downloads.packs[pack]));

/** Saving or about to save. */
export const busy = (downloads: Downloads) =>
  !!downloads.active || downloads.queued.length > 0;

/**
 * How much of the counted packs is kept, from 0 to 1; undefined until a
 * pack has been counted.
 */
export function overall(downloads: Downloads) {
  let saved = 0;
  let total = 0;
  for (const pack of PACK_ORDER) {
    const status = downloads.packs[pack];
    if (status.kind !== "ready" && status.kind !== "saving") continue;
    saved += status.saved;
    total += status.total;
  }
  return total ? saved / total : undefined;
}

export function downloadQueue(device: PackDevice) {
  let state: Downloads = {
    packs: { text: CHECKING, study: CHECKING },
    queued: [],
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<Downloads>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const rows = {} as Record<Pack, ReturnType<typeof packController>>;
  /** Count a pack's files afresh, replacing an earlier (failed) count. */
  const check = (pack: Pack) => {
    rows[pack]?.close();
    if (rows[pack]) set({ packs: { ...state.packs, [pack]: CHECKING } });
    rows[pack] = packController(pack, device, (status) =>
      set({ packs: { ...state.packs, [pack]: status } }),
    );
    return rows[pack];
  };
  PACK_ORDER.forEach(check);

  let queue: Pack[] = [];
  let running = false;
  const failed = (pack: Pack) => state.packs[pack].kind === "error";

  async function run() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const pack = queue[0];
        const row = failed(pack) ? check(pack) : rows[pack];
        await row.checked;
        // Cancelled while counting.
        if (queue[0] !== pack) continue;
        if (!failed(pack) && !isComplete(state.packs[pack])) {
          set({ active: pack, queued: queue.slice(1) });
          await row.save();
          if (queue[0] !== pack) continue;
        }
        // A failure stops the packs after it too; their rows stay as they are.
        if (failed(pack)) queue = [];
        else queue.shift();
        set({ active: undefined, queued: queue.slice() });
      }
    } finally {
      running = false;
      set({ active: undefined, queued: [] });
    }
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Queue these packs (in the queue's order) and save them in turn. */
    save(packs: readonly Pack[] = PACK_ORDER) {
      for (const pack of packs) if (!queue.includes(pack)) queue.push(pack);
      set({ queued: queue.slice(state.active ? 1 : 0) });
      return run();
    },
    /** Stop the pack being saved and drop the waiting ones. */
    cancel() {
      const active = state.active;
      queue = [];
      set({ queued: [] });
      if (active) rows[active].cancel();
    },
  };
}

export type DownloadQueue = ReturnType<typeof downloadQueue>;
