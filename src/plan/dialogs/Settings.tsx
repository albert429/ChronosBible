import { Users } from "lucide-react";
import { dateLabel } from "../../lib/format";
import { useToday } from "../../lib/useToday";
import { useProgress } from "../useProgress";
import type { Actions } from ".";

export default function Settings({
  chooseReader,
}: Actions & { chooseReader: (id: string | null) => void }) {
  const { member } = useProgress();
  const currentDate = useToday();
  const start = member?.startDate || currentDate;
  return (
    <>
      <h2 id="dialog-title">{member?.name}</h2>
      <p className="dialog-description">
        بدأت خطة الـ١٥٠ يومًا في {dateLabel(start)}. تقدمك في كل طريقة قراءة
        محفوظ في هذا المتصفح فقط. النسخ الاحتياطي في القائمة.
      </p>
      <button className="setting-row" onClick={() => chooseReader(null)}>
        <Users size={20} />
        تغيير القارئ على هذا الجهاز
      </button>
    </>
  );
}
