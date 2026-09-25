"use client";

import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/**
 * Bounded horizontal scroller. Ancestors use overflow-x-hidden, so the row
 * must have min-w-0 + explicit overflow; pointer-drag covers touch + mouse.
 */
export function TouchScrollRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScroll: number;
    axis: "undecided" | "x" | "y";
    captured: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = ref.current;
    if (!el) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: el.scrollLeft,
      axis: "undecided",
      captured: false,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const el = ref.current;
    if (!state || !el || state.pointerId !== e.pointerId) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (state.axis === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      state.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (state.axis === "y") {
        drag.current = null;
        return;
      }
      if (!state.captured) {
        el.setPointerCapture(e.pointerId);
        state.captured = true;
      }
    }

    if (state.axis !== "x") return;

    el.scrollLeft = state.startScroll - dx;
    e.preventDefault();
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const wasX = state.axis === "x";
    if (state.captured) {
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    drag.current = null;
    if (wasX) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 40);
    }
  }, []);

  return (
    <div
      className="flex w-full min-w-0 cursor-grab snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-3 pb-1 select-none active:cursor-grabbing [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] touch-pan-x"
      onClickCapture={(e) => {
        if (!suppressClick.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerCancel={endDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      ref={ref}
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}
    >
      {children}
    </div>
  );
}
