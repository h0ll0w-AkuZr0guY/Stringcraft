import { useCallback, useEffect, useState } from "react";
import { useWorkbenchContext } from "./WorkbenchContext";
/** Manual navigation suspends following until the user explicitly resumes it. */
export function useScoreFollow() {
  const [following, setFollowing] = useState(true);
  const { transport } = useWorkbenchContext();
  useEffect(() => {
    let revision = transport.snapshot().seekRevision;
    return transport.subscribe(() => {
      const next = transport.snapshot().seekRevision;
      if (next === revision) return;
      revision = next;
      setFollowing(true);
    });
  }, [transport]);
  const manual = useCallback(() => {
    setFollowing(false);
  }, []);
  const reveal = useCallback(
    (
      container: HTMLElement,
      target: { left: number; top: number; width: number; height: number },
      force = false,
    ) => {
      if (
        (!following && !force) ||
        !container.clientHeight ||
        !container.clientWidth
      )
        return;
      const x = target.left - container.scrollLeft,
        y = target.top - container.scrollTop;
      if (x < 0 || x + target.width > container.clientWidth * 0.8)
        container.scrollLeft = Math.max(
          0,
          target.left - container.clientWidth * 0.25,
        );
      if (y < 0 || y + target.height > container.clientHeight - 2)
        container.scrollTop = Math.max(0, target.top - 28);
    },
    [following],
  );
  const scrollbar = (e: {
    currentTarget: HTMLElement;
    clientX: number;
    clientY: number;
  }) => {
    const el = e.currentTarget,
      b = el.getBoundingClientRect();
    if (
      e.clientX >= b.left + el.clientWidth ||
      e.clientY >= b.top + el.clientHeight
    )
      manual();
  };
  const observe = useCallback(
    (container: HTMLElement) => {
      const pointer = (event: PointerEvent) => {
        const b = container.getBoundingClientRect();
        if (
          event.clientX >= b.left + container.clientWidth ||
          event.clientY >= b.top + container.clientHeight
        )
          manual();
      };
      container.addEventListener("wheel", manual, { passive: true });
      container.addEventListener("touchmove", manual, { passive: true });
      container.addEventListener("pointerdown", pointer);
      return () => {
        container.removeEventListener("wheel", manual);
        container.removeEventListener("touchmove", manual);
        container.removeEventListener("pointerdown", pointer);
      };
    },
    [manual],
  );
  return {
    following,
    manual,
    reveal,
    scrollbar,
    observe,
    resume: () => setFollowing(true),
  };
}
