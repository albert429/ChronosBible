import { passageElement, passageId } from "../../shared/browser/scriptureDom";

/**
 * Moving to one of the open reading's passages, handed to navigation by the
 * app: an address for its link and the jump itself, which focuses the
 * passage without scrolling, then brings its start into view.
 */
export const passageJump = {
  href: (index: number) => `#${passageId(index)}`,
  jump(index: number) {
    const target = passageElement(index);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start", behavior: "instant" });
  },
};
