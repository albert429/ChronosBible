import { lazy, type ComponentType } from "react";
import type { StreakSlotProps } from "./Streak";

// The streak UI is one small chunk, loaded when first shown. It is
// decorative: if it fails to load, nothing shows, so no error boundary is
// needed.
export const Streak = lazy(() =>
  import("./Streak").then(
    (m) => ({ default: m.StreakSlot }),
    () => ({ default: (() => null) as ComponentType<StreakSlotProps> }),
  ),
);
