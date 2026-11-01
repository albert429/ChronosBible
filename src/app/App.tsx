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
  const { member, location, reading, view } = session;
  const dialogs = useProfileDialogs(session);
  const { modal } = dialogs;
  const [notice, setNotice] = useNotice();
  useShownPreload(location, reading.data);
  useDocumentTitle(view, session.title);
  useKeyboardPaging({
    view,
    previous: session.previous,
    next: session.next,
    go: session.go,
  });

  function complete() {
    const done = session.complete();
    if (done) setNotice(done);
  }
  const goDay = (day: number) => session.go({ mode: "plan", day });
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
          go: session.go,
          chooseTrack: session.chooseTrack,
          navigate: session.navigate,
          readers: () => dialogs.open({ kind: member ? "settings" : "join" }),
          invite: (text) => dialogs.open({ kind: "invite", text }),
          notify: setNotice,
          goDay,
          passages: passageJump,
        }}
        data={{
          chronology: session.chronology.data,
          chronologyError: session.chronology.error,
          retryChronology: session.chronology.retry,
          completion: session.completion,
          continuous: session.continuous,
          setContinuous: session.setContinuous,
          selected: session.selected,
          reading: session.planReading.data,
          readingError: session.planReading.error,
          retryReading: session.planReading.retry,
        }}
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
            location={location}
            navigation={session.navigation}
            restore={session.restore}
            previous={session.previous}
            next={session.next}
            onPage={session.go}
            continuous={session.continuous}
            setContinuous={session.setContinuous}
            onContinue={session.onContinue}
            reading={reading.data}
            chronology={session.chronology.data}
            error={reading.error}
            retry={reading.retry}
            done={session.done}
            complete={complete}
          />
        ) : (
          <PlanView
            member={member}
            completed={session.completion.plan}
            start={session.start}
            currentDate={session.currentDate}
            current={session.current}
            page={session.page}
            setPage={session.setPage}
            go={goDay}
            join={() => dialogs.open({ kind: "join" })}
          />
        )}
      </main>
      <DialogHost
        modal={modal}
        close={dialogs.close}
        notice={notice}
        setNotice={setNotice}
        navigate={session.navigate}
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
