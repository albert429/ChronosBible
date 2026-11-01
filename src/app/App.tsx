import { useRef } from "react";
import { Check, X } from "lucide-react";
import Reader from "../features/reader/Reader";
import { passageJump } from "../features/reader/passageJump";
import Navigation from "../features/navigation/Navigation";
import PlanView from "../features/plan/PlanView";
import { useNotice } from "../shared/hooks/useNotice";
import { useReadingSession } from "./useReadingSession";
import { useProfileDialogs } from "./useProfileDialogs";
import { useKeyboardPaging } from "./useKeyboardPaging";
import { useDocumentTitle } from "./useDocumentTitle";
import { useShownPreload } from "./useShownPreload";
import DialogHost from "./DialogHost";

export default function App() {
  const main = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const session = useReadingSession(main);
  const { location, view } = session;
  const member = session.progress.member;
  const dialogs = useProfileDialogs(session);
  const { modal } = dialogs;
  const [notice, setNotice] = useNotice();
  useShownPreload(location, session.reader.reading);
  useDocumentTitle(view, session.title);
  useKeyboardPaging(session);

  function complete() {
    const done = session.complete();
    if (done) setNotice(done);
  }
  return (
    <div className="app">
      <Navigation
        location={location}
        previous={session.previous}
        next={session.next}
        readingTitle={session.title}
        view={view}
        menuToggle={menuToggle}
        actions={{
          ...session.actions,
          readers: () => dialogs.open({ kind: member ? "settings" : "join" }),
          invite: (text) => dialogs.open({ kind: "invite", text }),
          notify: setNotice,
          passages: passageJump,
        }}
        data={session.sheets}
      />
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={view === "read" ? "reading-main" : undefined}
      >
        {session.alert && !modal && (
          <div className="error" role="alert">
            <span>{session.alert}</span>
            <button
              className="icon-button"
              onClick={session.dismissAlert}
              aria-label="إغلاق التنبيه"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {view === "read" ? (
          <Reader
            key={member?.id || "guest"}
            {...session.reader}
            complete={complete}
          />
        ) : (
          <PlanView
            {...session.plan}
            join={() => dialogs.open({ kind: "join" })}
          />
        )}
      </main>
      <DialogHost
        modal={modal}
        close={dialogs.close}
        notice={notice}
        setNotice={setNotice}
        navigate={session.actions.navigate}
        chooseReader={dialogs.chooseReader}
        fallbackFocus={menuToggle}
      />
      {notice && !modal && (
        <div className="toast" role="status">
          <Check size={19} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
