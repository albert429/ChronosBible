import { useEffect, useRef, useState } from "react";
import { Check, Download, MonitorDown, X } from "lucide-react";
import { ar } from "../lib/format";
import { installApp, useAppUpdate } from "./register";
import {
  packUrls,
  savePack,
  savedCount,
  storageUsed,
  type Pack,
} from "./offline";
import "./OfflinePanel.css";

const PACKS: { pack: Pack; title: string; size: string }[] = [
  { pack: "text", title: "نص الكتاب المقدس", size: "نحو ٣ ميغابايت للتنزيل" },
  { pack: "study", title: "ملاحظات الدراسة", size: "نحو ١٣ ميغابايت للتنزيل" },
];

type Status =
  | { kind: "checking" }
  | { kind: "ready"; saved: number; total: number }
  | { kind: "saving"; saved: number; total: number }
  | { kind: "error"; message: string };

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
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const urls = useRef<string[]>([]);
  const abort = useRef<AbortController>(null);
  useEffect(() => {
    let active = true;
    packUrls(pack)
      .then(async (list) => {
        urls.current = list;
        const saved = await savedCount(list);
        if (active) setStatus({ kind: "ready", saved, total: list.length });
      })
      .catch(() => {
        if (active)
          setStatus({
            kind: "error",
            message: "تعذر التحقق من الملفات. تحقق من الاتصال.",
          });
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [pack]);
  async function save() {
    const controller = new AbortController();
    abort.current = controller;
    const total = urls.current.length;
    try {
      await savePack(
        urls.current,
        (saved) => setStatus({ kind: "saving", saved, total }),
        controller.signal,
      );
      setStatus({ kind: "ready", saved: total, total });
    } catch {
      const saved = await savedCount(urls.current).catch(() => 0);
      setStatus(
        controller.signal.aborted
          ? { kind: "ready", saved, total }
          : {
              kind: "error",
              message: "توقف الحفظ. تحقق من الاتصال وحاول مرة أخرى.",
            },
      );
    } finally {
      changed();
    }
  }
  const complete =
    status.kind === "ready" &&
    status.total > 0 &&
    status.saved === status.total;
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
          onClick={() => abort.current?.abort()}
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
