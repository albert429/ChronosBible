import { useEffect } from "react";
import { TRACK_NAMES } from "../domain/reading/labels";
import type { View } from "../features/navigation/model";

/** The tab title: the reading's title, or the plan's name on its calendar. */
export function documentTitle(view: View, title: string) {
  const page = view === "read" ? title : TRACK_NAMES.plan;
  return page ? `${page} · الكتاب المقدس` : "الكتاب المقدس";
}

export function useDocumentTitle(view: View, title: string) {
  useEffect(() => {
    document.title = documentTitle(view, title);
  }, [title, view]);
}
