import { useEffect, useState } from "react";
import { Check, Download, Smartphone, X } from "lucide-react";
import { ar } from "../../shared/lib/format";
import { installApp, standalone, useAppUpdate } from "./register";
import { storageUsed } from "./downloads";
import type { Pack } from "./packs";
import { isComplete } from "./packStatus";
import { PACK_ORDER } from "./downloadQueue";
import {
  saveOffline,
  stopSaving,
  useOfflineDownloads,
} from "./offlineDownloads";
import "./OfflinePanel.css";

const PACKS: Record<Pack, { title: string; size: string }> = {
  text: { title: "نص الكتاب المقدس", size: "نحو ٣ ميغابايت للتنزيل" },
  study: { title: "ملاحظات الدراسة", size: "نحو ١٣ ميغابايت للتنزيل" },
};

function PackRow({ pack }: { pack: Pack }) {
  const downloads = useOfflineDownloads();
  const { title, size } = PACKS[pack];
  const status = downloads.packs[pack];
  const complete = isComplete(status);
  const waiting = downloads.queued.includes(pack);
  const saving = status.kind === "saving" && downloads.active === pack;
  return (
    <div className="offline-pack">
      <div className="offline-pack-text">
        <span>{title}</span>
        <small>
          {complete
            ? "محفوظ على هذا الجهاز"
            : saving
              ? `${ar(status.saved)} من ${ar(status.total)} ملفًا`
              : waiting
                ? "في الانتظار"
                : status.kind === "error"
                  ? status.message
                  : status.kind === "ready" && status.saved
                    ? `محفوظ جزئيًا · ${size}`
                    : size}
        </small>
        {saving && (
          <progress
            value={status.saved}
            max={status.total}
            aria-label={`حفظ ${title}`}
          />
        )}
      </div>
      {complete ? (
        <Check size={20} className="offline-done" aria-hidden="true" />
      ) : saving || waiting ? (
        <button
          className="icon-button"
          aria-label={`إيقاف حفظ ${title}`}
          onClick={stopSaving}
        >
          <X size={18} aria-hidden="true" />
        </button>
      ) : (
        <button
          className="quiet-button offline-save"
          disabled={status.kind === "checking"}
          aria-label={`حفظ ${title} للقراءة دون اتصال`}
          onClick={() => void saveOffline([pack])}
        >
          <Download size={17} aria-hidden="true" />
          حفظ
        </button>
      )}
    </div>
  );
}

const ios =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Install the app and keep Scripture for reading without a connection. */
export default function OfflinePanel() {
  const { install } = useAppUpdate();
  const { active } = useOfflineDownloads();
  const [used, setUsed] = useState<number>();
  // Measured again whenever a pack starts or stops saving.
  useEffect(() => void storageUsed().then(setUsed), [active]);
  return (
    <div className="offline-panel">
      {install ? (
        <button className="menu-row" onClick={() => void installApp()}>
          <Smartphone size={18} aria-hidden="true" />
          تثبيت التطبيق
        </button>
      ) : (
        ios &&
        !standalone() && (
          <p>
            لتثبيت التطبيق على iPhone أو iPad: اضغط زر المشاركة ثم «إضافة إلى
            الشاشة الرئيسية».
          </p>
        )
      )}
      {PACK_ORDER.map((pack) => (
        <PackRow key={pack} pack={pack} />
      ))}
      <p>
        تُحفظ كل قراءة تفتحها تلقائيًا، ويحفظ التطبيق المثبّت النص ثم ملاحظات
        الدراسة بنفسه. التسجيلات الصوتية تحتاج إلى اتصال.
        {used !== undefined &&
          ` يستخدم التطبيق ${ar(Math.round(used * 10) / 10)} ميغابايت على هذا الجهاز.`}
      </p>
    </div>
  );
}
