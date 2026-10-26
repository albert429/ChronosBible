import { RefreshCw } from "lucide-react";
import { applyUpdate, useAppUpdate } from "./register";

/** Offered, never forced: reading is not interrupted by a new build. */
export default function UpdateNotice() {
  const { update } = useAppUpdate();
  if (!update) return null;
  return (
    <div className="update-notice">
      <span>تحديث جديد متاح</span>
      <button className="text-button" onClick={applyUpdate}>
        <RefreshCw size={16} aria-hidden="true" />
        تحديث
      </button>
    </div>
  );
}
