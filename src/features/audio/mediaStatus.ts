export type MediaStatus =
  "idle" | "loading" | "playing" | "buffering" | "ended";

export type MediaState = { status: MediaStatus; error: string };

export type MediaAction =
  | { type: "request" }
  | { type: "started" }
  | { type: "playing" }
  | { type: "waiting" }
  | { type: "paused"; message?: string }
  | { type: "ended" }
  | { type: "seeked" }
  | { type: "clearError" };

export const initialMediaState: MediaState = { status: "idle", error: "" };

export const isPlaying = (status: MediaStatus) =>
  status === "playing" || status === "buffering";
export const isWaiting = (status: MediaStatus) =>
  status === "loading" || status === "buffering";

export function mediaReducer(
  state: MediaState,
  action: MediaAction,
): MediaState {
  const { status } = state;
  switch (action.type) {
    case "request":
      return {
        status: isPlaying(status) ? "buffering" : "loading",
        error: "",
      };
    case "started":
      return { ...state, status: isPlaying(status) ? "playing" : "idle" };
    case "playing":
      return { ...state, status: "playing" };
    case "waiting":
      if (status === "ended") return state;
      return { ...state, status: isPlaying(status) ? "buffering" : "loading" };
    case "paused":
      return {
        status: status === "ended" ? "ended" : "idle",
        error: action.message ?? state.error,
      };
    case "ended":
      return { ...state, status: "ended" };
    case "seeked":
      return status === "ended" ? { ...state, status: "idle" } : state;
    case "clearError":
      return { ...state, error: "" };
  }
}
