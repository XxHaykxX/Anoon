"use client";

import { useRef, useState, type ReactNode, type PointerEvent } from "react";

/**
 * A single revealed action button shown behind a `SwipeableRow`'s content.
 */
interface Action {
  icon: ReactNode;
  label?: string;
  color?: "default" | "danger";
  onAction?: () => void;
}

interface SwipeableRowProps {
  children: ReactNode;
  actions: Action[];
}

const ACTION_WIDTH = 72;

/**
 * SwipeableRow
 *
 * A horizontal swipe-to-reveal-actions row, similar to the iOS Mail/Contacts
 * swipe interaction. The row's `children` sit on top of a hidden strip of
 * `actions` buttons anchored to the right edge. Dragging the content to the
 * left (via pointer or touch) reveals the actions; releasing the drag snaps
 * the row open (fully revealing the actions) if it was dragged past ~40% of
 * the actions' total width, or snaps back closed otherwise.
 *
 * Usage:
 * ```tsx
 * <SwipeableRow
 *   actions={[
 *     { icon: <ArchiveIcon />, label: "Archive", onAction: () => archive(contact.id) },
 *     { icon: <TrashIcon />, label: "Delete", color: "danger", onAction: () => remove(contact.id) },
 *   ]}
 * >
 *   <ContactRow contact={contact} />
 * </SwipeableRow>
 * ```
 */
export default function SwipeableRow({ children, actions }: SwipeableRowProps) {
  const actionsWidth = actions.length * ACTION_WIDTH;

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startXRef = useRef(0);
  const startOffsetRef = useRef(0);
  const draggingRef = useRef(false);

  const clamp = (value: number) => Math.min(0, Math.max(-actionsWidth, value));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (actionsWidth === 0) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    startXRef.current = event.clientX;
    startOffsetRef.current = offset;
    draggingRef.current = true;
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = event.clientX - startXRef.current;
    setOffset(clamp(startOffsetRef.current + delta));
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setOffset((current) => {
      const threshold = actionsWidth * 0.4;
      return -current > threshold ? -actionsWidth : 0;
    });
  };

  const handlePointerUp = () => {
    endDrag();
  };

  const handlePointerCancel = () => {
    endDrag();
  };

  const close = () => setOffset(0);

  return (
    <div className="relative overflow-hidden">
      {actionsWidth > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: actionsWidth }}>
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              aria-label={action.label}
              onClick={() => {
                close();
                action.onAction?.();
              }}
              className={
                action.color === "danger"
                  ? "grid w-[72px] place-items-center bg-[color:var(--destructive)] text-white"
                  : "grid w-[72px] place-items-center bg-muted"
              }
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={
          dragging
            ? "relative touch-pan-y bg-background will-change-transform"
            : "relative touch-pan-y bg-background transition-transform duration-200 will-change-transform"
        }
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
