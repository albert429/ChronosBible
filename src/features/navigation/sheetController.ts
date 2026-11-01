/**
 * An action deferred until a sheet has finished closing. The sheet runs
 * `closed` after its dialog closes and focus returns to the trigger, so a
 * deferred navigation, dialog or passage jump moves focus last.
 */
export function createAfterClose() {
  let pending: (() => void) | null = null;
  return {
    /** Opening a sheet drops an action an earlier close left pending. */
    opened() {
      pending = null;
    },
    /** Closing, optionally with what to do once closed. */
    closing(action?: () => void) {
      pending = action || null;
    },
    /** The sheet has closed and restored focus: runs the action once. */
    closed() {
      const action = pending;
      pending = null;
      action?.();
    },
  };
}
