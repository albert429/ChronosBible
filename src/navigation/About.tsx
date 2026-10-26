import { APP_INFO } from "../appInfo";
import ReactIcon from "../components/ReactIcon";
import churchLogo from "../assets/church-logo-192.png";
import "./About.css";

export default function About() {
  return (
    <section className="about-content" aria-label="معلومات التطبيق">
      <div className="about-intro">
        <p className="about-purpose">
          لقراءة الكتاب المقدس والاستماع إليه: سفرًا سفرًا بالترتيب المعتاد، أو
          بالترتيب الزمني للعهدين القديم والجديد بحسب وقتك. ويضم خطة شباب{" "}
          {APP_INFO.church} لقراءة العهد الجديد في ١٥٠ يومًا.
        </p>
        <div className="about-church-logo">
          <img
            src={churchLogo}
            width="192"
            height="192"
            alt={APP_INFO.church}
          />
        </div>
      </div>
      <p className="about-contact-label">للشكاوى والاستفسارات</p>
      <ul className="about-contacts">
        <li>
          <span>البريد الإلكتروني</span>
          <a href={`mailto:${APP_INFO.email}`} dir="ltr">
            {APP_INFO.email}
          </a>
        </li>
        <li>
          <span>GitHub</span>
          <a
            href={APP_INFO.githubUrl}
            dir="ltr"
            target="_blank"
            rel="noreferrer"
          >
            {APP_INFO.githubName}
          </a>
        </li>
      </ul>
      <p className="about-rights">
        نص الكتاب المقدس من ترجمة فان دايك، نسخة <bdi>arb-vd</bdi> المنشورة على{" "}
        <a href={APP_INFO.scriptureSource} target="_blank" rel="noreferrer">
          eBible.org
        </a>
        ، والمصنّفة هناك ضمن الملكية العامة. لا يدّعي هذا التطبيق أي حقوق نشر
        على النص الكتابي.
      </p>
      <p className="about-rights">
        دراسة الآيات: الكلمات الأصلية باليونانية والعبرية والآرامية والقاموس من{" "}
        <a
          href="https://github.com/STEPBible/STEPBible-Data"
          target="_blank"
          rel="noreferrer"
        >
          STEPBible.org
        </a>{" "}
        والخدمة العربية للكرازة بالإنجيل (CC BY-SA وCC BY)، والترجمة العربية
        الجديدة (كتاب الحياة) © Biblica, Inc. (CC BY-SA)، والترجمة الإنجليزية
        الملك جيمس (KJV، ملكية عامة).{" "}
        <a href="/licenses/study-data.txt" target="_blank" rel="noreferrer">
          تفاصيل التراخيص
        </a>
      </p>
      <p className="about-rights">
        العهد الجديد: القراءة الدرامية · ترجمة فان دايك
        <br />
        توقيت تظليل الآيات تقريبي.
        <br />© 1996 جمعية الكتاب المقدس بمصر · ℗ 2008 Hosanna / Faith Comes By
        Hearing
        <br />
        <a
          href="https://www.faithcomesbyhearing.com/"
          target="_blank"
          rel="noreferrer"
        >
          مصدر التسجيل
        </a>
      </p>
      <p className="about-rights">
        العهد القديم: قراءة غير درامية · ترجمة فان دايك
        <br />
        تسجيلات العهد القديم بلا تتبع للآيات حاليًا.
        <br />© 1999 جمعية الكتاب المقدس بمصر · ℗ جمعية الكتاب المقدس بمصر ·
        Hosanna / Faith Comes By Hearing
        <br />
        <a
          href="https://www.faithcomesbyhearing.com/"
          target="_blank"
          rel="noreferrer"
        >
          مصدر تسجيل العهد القديم
        </a>
      </p>
      {__AI_ENABLED__ && (
        <p className="about-rights">
          شرح الآيات بالذكاء الاصطناعي اختياري: عند استخدامه تُرسَل الآية
          وسياقها، وسؤالك إن كتبته، إلى خدمة <bdi>OpenRouter</bdi> ثم إلى مزوّد
          النموذج، الذي قد يحتفظ بالنص ويستخدمه لتحسين نماذجه. لا يُرسَل اسمك أو
          تقدّمك. الإجابات آلية وقد تحتوي أخطاء.
        </p>
      )}
      <p className="react-credit" lang="en" dir="ltr">
        <ReactIcon />
        <span>Built using React</span>
      </p>
    </section>
  );
}
