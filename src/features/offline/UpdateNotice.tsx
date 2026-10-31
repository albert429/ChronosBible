import { createRoot } from "react-dom/client";
import { RefreshCw } from "lucide-react";
import { applyUpdate, useAppUpdate } from "./register";
import "./UpdateNotice.css";

/** Offered, never forced: reading is not interrupted by a new build. */
function UpdateNotice() {
  const { update } = useAppUpdate();
  if (!update) return null;
  return (
    <div className="update-notice" lang="ar" dir="rtl">
      <span>تحديث جديد متاح</span>
      <button className="text-button" onClick={applyUpdate}>
        <RefreshCw size={16} aria-hidden="true" />
        تحديث
      </button>
    </div>
  );
}

let shown = false;
/** Mount the notice once, beside the app's own root. */
export function showUpdateNotice() {
  if (shown) return;
  shown = true;
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(<UpdateNotice />);
}
