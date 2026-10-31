import { BookOpen, Link, Users } from "lucide-react";
import type { View } from "../../navigation/Navigation";
import { useProgress } from "../useProgress";
import Invite from "./Invite";
import Join from "./Join";
import Settings from "./Settings";
import "../../../shared/ui/form.css";
import "./dialogs.css";

export type Modal =
  { kind: "join" } | { kind: "settings" } | { kind: "invite"; text: string };
export type Actions = {
  close: () => void;
  navigate: (view: View) => void;
  setNotice: (notice: string) => void;
};
type Props = Actions & {
  modal: Modal;
  chooseReader: (id: string | null) => void;
};
export default function Dialogs({ modal, chooseReader, ...actions }: Props) {
  const { error } = useProgress();
  return (
    <>
      <span className="large-icon" aria-hidden="true">
        {modal.kind === "join" ? (
          <BookOpen size={26} />
        ) : modal.kind === "settings" ? (
          <Users size={26} />
        ) : (
          <Link size={26} />
        )}
      </span>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {modal.kind === "join" ? (
        <Join chooseReader={chooseReader} {...actions} />
      ) : modal.kind === "settings" ? (
        <Settings chooseReader={chooseReader} {...actions} />
      ) : (
        <Invite text={modal.text} setNotice={actions.setNotice} />
      )}
    </>
  );
}
