import { Minus, Plus, Sun, Moon } from "lucide-react";
import { ar } from "../lib/format";
import { FONT_MIN, FONT_MAX, useAppearance } from "./appearance";
import "./AppearancePanel.css";

export default function AppearancePanel({
  continuous,
  setContinuous,
}: {
  continuous: boolean;
  setContinuous: (enabled: boolean) => void;
}) {
  const { font, setFont, dark, setDark, diacritics, setDiacritics } =
    useAppearance();
  return (
    <>
      <div className="appearance-row">
        <span>حجم الخط</span>
        <div className="font-controls" role="group" aria-label="حجم خط القراءة">
          <button
            className="icon-button"
            onClick={() => setFont(Math.max(FONT_MIN, font - 2))}
            disabled={font <= FONT_MIN}
            aria-label="تصغير الخط"
          >
            <Minus size={18} />
          </button>
          <output aria-live="polite" aria-label="حجم الخط">
            {ar(font)}
          </output>
          <button
            className="icon-button"
            onClick={() => setFont(Math.min(FONT_MAX, font + 2))}
            disabled={font >= FONT_MAX}
            aria-label="تكبير الخط"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
      <label className="appearance-row continuous-option">
        <span>استماع متواصل للإصحاحات</span>
        <input
          type="checkbox"
          checked={continuous}
          onChange={(event) => setContinuous(event.target.checked)}
        />
      </label>
      <label className="appearance-row continuous-option">
        <span>إظهار التشكيل</span>
        <input
          type="checkbox"
          checked={diacritics}
          onChange={(event) => setDiacritics(event.target.checked)}
        />
      </label>
      <div className="theme-options" role="group" aria-label="مظهر القراءة">
        <button
          className="theme-option"
          aria-label="الوضع النهاري"
          aria-pressed={!dark}
          onClick={() => setDark(false)}
        >
          <Sun size={20} aria-hidden="true" />
          نهاري
        </button>
        <button
          className="theme-option"
          aria-label="الوضع الليلي"
          aria-pressed={dark}
          onClick={() => setDark(true)}
        >
          <Moon size={20} aria-hidden="true" />
          ليلي
        </button>
      </div>
    </>
  );
}
