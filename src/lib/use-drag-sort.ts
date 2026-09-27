import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const DRAG_THRESHOLD = 5; // mouse/pen: jarak (px) sebelum drag dimulai — perilaku desktop lama
const TOUCH_SLOP = 8; // sentuh: geser sejauh ini sebelum hold selesai = niat scroll, batal
const HOLD_MS = 250; // sentuh: durasi tahan sebelum drag aktif

interface DownState {
  index: number;
  x: number;
  y: number;
  pointerId: number;
  touch: boolean;
  hold: number | null;
  releaseTouchBlock?: () => void;
}

export interface DragSortApi {
  dragging: number | null;
  over: number | null;
  /** Timestamp drag terakhir — untuk menekan click zoom yang menyusul drag. */
  didDragAt: () => number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, index: number) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (index: number) => void;
  onPointerEnter: (index: number) => void;
  cancel: () => void;
}

/**
 * Drag-urut kartu/baris berbasis Pointer Events.
 * - Mouse/pen: drag langsung setelah melewati DRAG_THRESHOLD.
 * - Sentuh: tahan HOLD_MS tanpa bergeser melebihi TOUCH_SLOP untuk mulai drag;
 *   sebelum itu gesture diserahkan ke browser (scroll tetap jalan). Setelah
 *   drag aktif, touchmove di-preventDefault supaya halaman tidak ikut tergulir.
 */
export function useDragSort(
  targetSelector: string,
  dataKey: string,
  onMove: (from: number, to: number) => void,
): DragSortApi {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const downRef = useRef<DownState | null>(null);
  const draggingRef = useRef<number | null>(null);
  const overRef = useRef<number | null>(null);
  const didDragAtRef = useRef(0);

  const cancelDown = () => {
    const down = downRef.current;
    if (!down) return;
    if (down.hold !== null) clearTimeout(down.hold);
    down.releaseTouchBlock?.();
    downRef.current = null;
  };

  const cleanup = () => {
    cancelDown();
    draggingRef.current = null;
    overRef.current = null;
    setDragging(null);
    setOver(null);
  };

  const activate = (index: number) => {
    const down = downRef.current;
    if (!down) return;
    if (down.hold !== null) {
      clearTimeout(down.hold);
      down.hold = null;
    }
    draggingRef.current = index;
    overRef.current = index;
    didDragAtRef.current = Date.now();
    setDragging(index);
    setOver(index);
  };

  const findTarget = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(targetSelector);
    const value = el ? Number(el.dataset[dataKey]) : NaN;
    return Number.isInteger(value) ? value : null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    // Satu gesture dalam satu waktu: abaikan sentuhan kedua saat drag/tekan berjalan.
    if (downRef.current || draggingRef.current !== null) return;
    const touch = event.pointerType === 'touch';
    const card = event.currentTarget;
    const down: DownState = { index, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch, hold: null };
    if (touch) {
      // Setelah drag aktif, gesture sudah berjalan sehingga touch-action CSS
      // tidak berlaku lagi; blok scroll lewat touchmove non-passive.
      const block = (e: TouchEvent) => {
        if (draggingRef.current !== null) e.preventDefault();
      };
      card.addEventListener('touchmove', block, { passive: false });
      down.releaseTouchBlock = () => card.removeEventListener('touchmove', block);
      // Tahan dulu: selama menunggu hold, gesture milik scroll.
      down.hold = window.setTimeout(() => {
        if (downRef.current !== down) return;
        activate(index);
        try {
          card.setPointerCapture(down.pointerId);
        } catch {
          /* ignore */
        }
      }, HOLD_MS);
    } else {
      // Mouse/pen: capture sejak awal agar move tetap mengalir ke kartu ini.
      try {
        card.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    downRef.current = down;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const down = downRef.current;
    if (!down || event.pointerId !== down.pointerId) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (draggingRef.current === null) {
      if (down.touch) {
        if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) cancelDown();
        return;
      }
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) activate(down.index);
      return;
    }
    const next = findTarget(event.clientX, event.clientY);
    overRef.current = next;
    setOver(next);
  };

  const onPointerUp = (index: number) => {
    if (draggingRef.current !== null) {
      const target = overRef.current ?? index;
      if (draggingRef.current !== target) onMove(draggingRef.current, target);
      didDragAtRef.current = Date.now();
    }
    cleanup();
  };

  const onPointerEnter = (index: number) => {
    if (draggingRef.current !== null) {
      overRef.current = index;
      setOver(index);
    }
  };

  // Unmount: pastikan timer hold dan listener touchmove tidak tertinggal.
  useEffect(
    () => () => {
      cancelDown();
    },
    [],
  );

  return {
    dragging,
    over,
    didDragAt: () => didDragAtRef.current,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerEnter,
    cancel: cleanup,
  };
}
