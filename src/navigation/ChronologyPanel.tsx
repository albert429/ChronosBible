import { useId, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown } from "lucide-react";
import type { ChronologicalLocation } from "../bible/types";
import type {
  ChronologicalReadingSummary,
  ChronologyCatalog,
  ChronologyStage,
} from "../chronology/types";
import { ar } from "../lib/format";
import { Loading, LoadError } from "../components/Feedback";
import { continueReading, durationLabel, minutesLabel } from "./modes";
import "./ChronologyPanel.css";

type Props = {
  chronology?: ChronologyCatalog;
  error?: string;
  retry: () => void;
  location: ChronologicalLocation;
  /** This reader's completed reading ids in this testament. */
  completed: readonly string[];
  go: (location: ChronologicalLocation) => void;
  close: (action?: () => void) => void;
};

function StageSection({
  stage,
  readings,
  done,
  current,
  open,
  toggle,
  choose,
}: {
  stage: ChronologyStage;
  readings: ChronologicalReadingSummary[];
  done: ReadonlySet<string>;
  current: string;
  open: boolean;
  toggle: () => void;
  choose: (id: string) => void;
}) {
  const id = useId();
  const finished = readings.filter((reading) => done.has(reading.id)).length;
  const minutes = readings.reduce((sum, r) => sum + r.estimatedMinutes, 0);
  const groups = [
    { id: "", title: "", items: readings.filter((r) => !r.substageId) },
    ...(stage.substages ?? []).map((substage) => ({
      id: substage.id,
      title: substage.title,
      items: readings.filter((r) => r.substageId === substage.id),
    })),
  ].filter((group) => group.items.length);
  return (
    <li className="stage">
      <h3>
        <button
          type="button"
          className="stage-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
        >
          <span className="stage-title">{stage.title}</span>
          <span className="stage-meta">
            {ar(finished)} من {ar(readings.length)} · نحو{" "}
            {durationLabel(minutes)}
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </h3>
      <div id={id} hidden={!open}>
        {open &&
          groups.map((group) => (
            <div className="substage" key={group.id}>
              {group.title && <h4>{group.title}</h4>}
              <ol className="reading-list">
                {group.items.map((reading) => {
                  const complete = done.has(reading.id);
                  return (
                    <li key={reading.id}>
                      <button
                        type="button"
                        data-reading-id={reading.id}
                        aria-current={
                          reading.id === current ? "page" : undefined
                        }
                        aria-label={`${reading.title}، ${minutesLabel(reading.estimatedMinutes)}${complete ? "، مكتملة" : ""}`}
                        onClick={() => choose(reading.id)}
                      >
                        <span className="reading-status" aria-hidden="true">
                          {complete && <Check size={16} />}
                        </span>
                        <span className="reading-title">{reading.title}</span>
                        <span className="reading-minutes" aria-hidden="true">
                          {minutesLabel(reading.estimatedMinutes)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
      </div>
    </li>
  );
}

export default function ChronologyPanel({
  chronology,
  error,
  retry,
  location,
  completed,
  go,
  close,
}: Props) {
  const current = location.readingId;
  const currentStage = chronology?.readings.find(
    (reading) => reading.id === current,
  )?.stageId;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(currentStage ? [currentStage] : []),
  );
  const [seenStage, setSeenStage] = useState(currentStage);
  if (seenStage !== currentStage) {
    // The catalog arrived after the sheet opened: show the current stage.
    setSeenStage(currentStage);
    if (currentStage) setExpanded((open) => new Set([...open, currentStage]));
  }
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    // Open on the current reading, not at the top of a long chronology.
    list.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [currentStage]);
  if (error) return <LoadError message={error} retry={retry} />;
  if (!chronology) return <Loading label="جارٍ تحميل فهرس القراءة…" />;
  const done = new Set(completed);
  const readings = chronology.readings;
  const finished = readings.filter((reading) => done.has(reading.id)).length;
  const next = continueReading(readings, current, done);
  function choose(id: string) {
    close(() =>
      go({
        mode: "chronological",
        testament: chronology!.testament,
        readingId: id,
      }),
    );
  }
  return (
    <div className="chronology-panel">
      <div className="chronology-progress">
        <p>
          القراءات المكتملة: {ar(finished)} من {ar(readings.length)}
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="التقدم في القراءة الزمنية"
          aria-valuenow={finished}
          aria-valuemin={0}
          aria-valuemax={readings.length}
        >
          <i style={{ width: `${(finished / readings.length) * 100}%` }} />
        </div>
      </div>
      {next && (
        <button
          type="button"
          className="primary full continue-reading"
          onClick={() => (next.id === current ? close() : choose(next.id))}
        >
          <BookOpen size={18} aria-hidden="true" />
          متابعة القراءة
        </button>
      )}
      <ol className="stage-list" ref={list} aria-label="مراحل القراءة">
        {chronology.stages.map((stage) => (
          <StageSection
            key={stage.id}
            stage={stage}
            readings={readings.filter((r) => r.stageId === stage.id)}
            done={done}
            current={current}
            open={expanded.has(stage.id)}
            toggle={() =>
              setExpanded((open) => {
                const next = new Set(open);
                if (!next.delete(stage.id)) next.add(stage.id);
                return next;
              })
            }
            choose={choose}
          />
        ))}
      </ol>
      {chronology.sources.length > 0 && (
        <p className="chronology-source">
          الترتيب الزمني عن:{" "}
          {chronology.sources.map((source) => source.title).join("، ")}
        </p>
      )}
    </div>
  );
}
