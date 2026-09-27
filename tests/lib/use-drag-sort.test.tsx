/**
 * Test useDragSort: long-press drag untuk sentuh (tahan dulu, geser sebelum
 * hold selesai = scroll), drag langsung untuk mouse.
 */
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDragSort } from '../../src/lib/use-drag-sort';

// ElementFromPoint tidak diimplementasikan jsdom — stub berdasar clientY
// (tiap item dianggap setinggi 100px).
beforeAll(() => {
  (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (_x: number, y: number) => {
    const idx = Math.max(0, Math.min(2, Math.floor(y / 100)));
    return document.querySelectorAll('[data-item]')[idx] ?? null;
  };
});
afterAll(() => {
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
});

function pointer(type: string, init: { pointerType: string; clientX?: number; clientY?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(event, { pointerId: 1, ...init });
  return event;
}

function Harness({ onMove }: { onMove: (from: number, to: number) => void }) {
  const drag = useDragSort('[data-item]', 'itemIndex', onMove);
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          data-item={i}
          data-item-index={i}
          data-dragging={drag.dragging !== null ? 'true' : undefined}
          onPointerDown={(e) => drag.onPointerDown(e, i)}
          onPointerMove={drag.onPointerMove}
          onPointerUp={() => drag.onPointerUp(i)}
        />
      ))}
    </div>
  );
}

function mount(onMove: (from: number, to: number) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(<Harness onMove={onMove} />));
  return {
    items: () => [...container.querySelectorAll<HTMLElement>('[data-item]')],
    dragging: () => container.querySelector<HTMLElement>('[data-dragging="true"]'),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useDragSort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sentuh: tahan 250ms mengaktifkan drag, geser lalu lepas memindahkan item', () => {
    const onMove = vi.fn();
    const ui = mount(onMove);
    const first = ui.items()[0];

    act(() => first.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientY: 50 })));
    act(() => first.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientY: 54 })));
    expect(ui.dragging()).toBeNull(); // masih menunggu hold

    act(() => vi.advanceTimersByTime(260));
    expect(ui.dragging()).toBe(first); // drag aktif setelah tahan

    act(() => first.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientY: 250 })));
    act(() => first.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientY: 250 })));
    expect(onMove).toHaveBeenCalledWith(0, 2);
    ui.unmount();
  });

  it('sentuh: geser sebelum hold selesai membatalkan drag (gesture menjadi scroll)', () => {
    const onMove = vi.fn();
    const ui = mount(onMove);
    const first = ui.items()[0];

    act(() => first.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientY: 50 })));
    act(() => first.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientY: 90 })));
    act(() => vi.advanceTimersByTime(400));
    act(() => first.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientY: 90 })));

    expect(ui.dragging()).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    ui.unmount();
  });

  it('mouse: drag langsung tanpa menunggu hold', () => {
    const onMove = vi.fn();
    const ui = mount(onMove);
    const first = ui.items()[0];

    act(() => first.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientY: 50 })));
    act(() => first.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', clientY: 58 })));
    expect(ui.dragging()).toBe(first); // aktif tanpa timer

    act(() => first.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', clientY: 150 })));
    act(() => first.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', clientY: 150 })));
    expect(onMove).toHaveBeenCalledWith(0, 1);
    ui.unmount();
  });
});
