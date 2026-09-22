import { afterEach, describe, expect, it } from 'bun:test';
import { makeWatcher } from './on-screen';

/** Stands in for the browser's observer: the test decides what comes into view. */
class StubObserver {
  static made = 0;
  static live: StubObserver[] = [];
  readonly watched = new Set<Element>();
  constructor(private readonly notify: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    StubObserver.made += 1;
    StubObserver.live.push(this);
  }
  observe(el: Element): void { this.watched.add(el); }
  unobserve(el: Element): void { this.watched.delete(el); }
  disconnect(): void { this.watched.clear(); }
  /** Reports one element as visible, the way the browser would. */
  show(el: Element): void { this.notify([{ target: el, isIntersecting: true }]); }
}

/** A fresh watcher per test: one observer is shared by its own cells, not by tests. */
function watcher() {
  return makeWatcher();
}

function withStub<T>(run: () => T): T {
  const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = StubObserver;
  try {
    return run();
  } finally {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original;
  }
}

const cell = (): Element => ({ nodeName: 'CANVAS' } as unknown as Element);

afterEach(() => {
  StubObserver.made = 0;
  StubObserver.live = [];
});

describe('one observer for the whole strip', () => {
  it('watches a thousand cells without a thousand observers', () => {
    withStub(() => {
      const whenOnScreen = watcher();
      for (let i = 0; i < 1000; i++) whenOnScreen(cell(), () => {});
      expect(StubObserver.made).toBe(1);
      expect(StubObserver.live[0].watched.size).toBe(1000);
    });
  });

  it('tells a cell once, when it comes into view, and then stops watching it', () => {
    withStub(() => {
      const el = cell();
      let told = 0;
      watcher()(el, () => { told += 1; });
      const observer = StubObserver.live[0];

      expect(told).toBe(0);
      observer.show(el);
      expect(told).toBe(1);
      expect(observer.watched.has(el)).toBe(false);

      // A second report for an element already told changes nothing.
      observer.show(el);
      expect(told).toBe(1);
    });
  });

  it('stops watching a cell that is taken off the strip', () => {
    withStub(() => {
      const el = cell();
      let told = 0;
      const stop = watcher()(el, () => { told += 1; });
      const observer = StubObserver.live[0];

      stop();
      expect(observer.watched.has(el)).toBe(false);
      observer.show(el);
      expect(told).toBe(0);
    });
  });

  it('draws at once on an engine without an observer', () => {
    const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    try {
      let told = 0;
      makeWatcher()(cell(), () => { told += 1; });
      // No observer is a reason to draw, not a reason to show an empty cell.
      expect(told).toBe(1);
    } finally {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original;
    }
  });
});
