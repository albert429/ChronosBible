import { useEffect, useRef, useState } from "react";
import { Check, Download, MonitorDown, X } from "lucide-react";
import { ar } from "../../shared/lib/format";
import { installApp, useAppUpdate } from "./register";
import { savePack, savedCount, storageUsed } from "./downloads";
import { packUrls, type Pack } from "./packs";
import {
  isComplete,
  packController,
  type PackDevice,
  type PackStatus,
} from "./packStatus";
import "./OfflinePanel.css";

const PACKS: { pack: Pack; title: string; size: string }[] = [
  { pack: "text", title: "نص الكتاب المقدس", size: "نحو ٣ ميغابايت للتنزيل" },
  { pack: "study", title: "ملاحظات الدراسة", size: "نحو ١٣ ميغابايت للتنزيل" },
];
const device: PackDevice = { list: packUrls, savedCount, save: savePack };

/** A pack row's status and actions, for as long as the row is shown. */
function usePack(pack: Pack, changed: () => void) {
  const [status, setStatus] = useState<PackStatus>({ kind: "checking" });
  const controller = useRef<ReturnType<typeof packController>>(null);
  useEffect(() => {
    const current = packController(pack, device, setStatus);
    controller.current = current;
    return () => current.close();
  }, [pack]);
  return {
    status,
    save: () => void controller.current?.save().then(changed),
    cancel: () => controller.current?.cancel(),
  };
}

function PackRow({
  pack,
  title,
  size,
  changed,
}: {
  pack: Pack;
  title: string;
  size: string;
  changed: () => void;
}) {
  const { status, save, cancel } = usePack(pack, changed);
  const complete = isComplete(status);
  return (
    <div className="offline-pack">
      <div className="offline-pack-text">
        <span>{title}</span>
        <small>
          {complete
            ? "محفوظ على هذا الجهاز"
            : status.kind === "saving"
              ? `${ar(status.saved)} من ${ar(status.total)} ملفًا`
              : status.kind === "error"
                ? status.message
                : status.kind === "ready" && status.saved
                  ? `محفوظ جزئيًا · ${size}`
                  : size}
        </small>
        {status.kind === "saving" && (
          <progress
            value={status.saved}
            max={status.total}
            aria-label={`حفظ ${title}`}
          />
        )}
      </div>
      {complete ? (
        <Check size={20} className="offline-done" aria-hidden="true" />
      ) : status.kind === "saving" ? (
        <button
          className="icon-button"
          aria-label={`إيقاف حفظ ${title}`}
          onClick={cancel}
        >
          <X size={18} aria-hidden="true" />
        </button>
      ) : (
        <button
          className="quiet-button offline-save"
          disabled={status.kind === "checking"}
          aria-label={`حفظ ${title} للقراءة دون اتصال`}
          onClick={save}
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
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Install the app and keep Scripture for reading without a connection. */
export default function OfflinePanel() {
  const { install } = useAppUpdate();
  const [used, setUsed] = useState<number>();
  const refresh = () => void storageUsed().then(setUsed);
  useEffect(refresh, []);
  return (
    <div className="offline-panel">
      {install ? (
        <button className="menu-row" onClick={() => void installApp()}>
          <MonitorDown size={18} aria-hidden="true" />
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
      {PACKS.map((item) => (
        <PackRow key={item.pack} {...item} changed={refresh} />
      ))}
      <p>
        تُحفظ كل قراءة تفتحها تلقائيًا. التسجيلات الصوتية تحتاج إلى اتصال.
        {used !== undefined &&
          ` يستخدم التطبيق ${ar(Math.round(used * 10) / 10)} ميغابايت على هذا الجهاز.`}
      </p>
    </div>
  );
}
