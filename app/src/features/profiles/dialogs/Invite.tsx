import { Copy } from "lucide-react";

export default function Invite({
  text,
  setNotice,
}: {
  text: string;
  setNotice: (notice: string) => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("تم النسخ");
    } catch {
      setNotice("يمكنك تحديد النص ونسخه من الحقل.");
    }
  }
  return (
    <>
      <h2 id="dialog-title">مشاركة التطبيق</h2>
      <p className="dialog-description">
        شارك التطبيق مع أصدقائك. لا يتضمن النص اسمك أو تقدمك.
      </p>
      <textarea
        className="link-field"
        aria-label="نص المشاركة"
        dir="auto"
        rows={5}
        readOnly
        value={text}
        onFocus={(event) => event.target.select()}
      />
      <button className="primary full" onClick={copy}>
        <Copy size={18} />
        نسخ
      </button>
    </>
  );
}
