import { ArrowLeft, Upload } from "lucide-react";
import type { FormEvent } from "react";
import { ar } from "../../lib/format";
import { useToday } from "../../lib/useToday";
import { useProgress } from "../useProgress";
import RestoreButton from "./RestoreButton";
import type { Actions } from ".";

export default function Join({
  chooseReader,
  ...actions
}: Actions & { chooseReader: (id: string | null) => void }) {
  const { profiles, create } = useProgress();
  const currentDate = useToday();
  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      create(String(data.get("name") || ""), String(data.get("start") || ""))
    ) {
      actions.close();
      actions.navigate("read");
      actions.setNotice("أهلًا بك! حُفظ القارئ على هذا الجهاز.");
    }
  }
  return (
    <>
      <h2 id="dialog-title">القراء على هذا الجهاز</h2>
      <p className="dialog-description">
        القراءة متاحة دون اسم. أضف اسمًا وتاريخ بداية لخطة الـ١٥٠ يومًا ليكون لك
        تقدم منفصل على هذا المتصفح، دون حساب أو تسجيل دخول.
      </p>
      {profiles.length > 0 && (
        <label className="reader-picker">
          متابعة قارئ محفوظ
          <select
            defaultValue=""
            onChange={(event) => chooseReader(event.target.value)}
          >
            <option value="" disabled>
              اختر قارئًا
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {ar(profile.completed.length)} يومًا ·{" "}
                {profile.startDate}
              </option>
            ))}
          </select>
        </label>
      )}
      <form onSubmit={join}>
        <label>
          الاسم
          <input
            name="name"
            autoComplete="given-name"
            required
            maxLength={60}
            placeholder="بماذا نناديك؟"
            autoFocus
          />
        </label>
        <label>
          تاريخ بداية الخطة
          <input
            name="start"
            type="date"
            defaultValue={currentDate}
            min="2000-01-01"
            max="2100-12-31"
            required
          />
        </label>
        <p className="form-hint">يمكنك تعويض أي يوم أو القراءة مسبقًا.</p>
        <button className="primary full">
          إضافة القارئ
          <ArrowLeft size={18} />
        </button>
      </form>
      <RestoreButton {...actions}>
        <Upload size={19} />
        استعادة نسخة احتياطية
      </RestoreButton>
      <p className="privacy-note">
        نزّل نسخة احتياطية من الإعدادات قبل تغيير جهازك أو مسح بيانات المتصفح.
      </p>
    </>
  );
}
