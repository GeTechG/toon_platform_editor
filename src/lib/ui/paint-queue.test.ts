import { describe, expect, it } from 'bun:test';
import { makePaintQueue } from './paint-queue';

/** A clock the test moves and a scheduler the test fires by hand. */
function harness(budget = 8) {
  let now = 0;
  const pending: (() => void)[] = [];
  const queue = makePaintQueue({
    budget,
    now: () => now,
    later: (run) => pending.push(run),
  });
  const tick = () => pending.splice(0).forEach((run) => run());
  const advance = (ms: number) => (now += ms);
  return { queue, tick, advance, pending };
}

describe('paint queue', () => {
  it('paints nothing in the pass that asked: the canvas goes to the screen first', () => {
    const { queue, tick } = harness();
    const done: string[] = [];
    queue.ask({}, () => done.push('a'));
    expect(done).toEqual([]);
    tick();
    expect(done).toEqual(['a']);
  });

  it('paints in the order asked, as many as fit in one slice, the rest in the next', () => {
    const { queue, tick, advance } = harness(8);
    const done: string[] = [];
    for (const name of ['a', 'b', 'c', 'd']) {
      queue.ask({}, () => {
        done.push(name);
        advance(5);
      });
    }
    tick();
    expect(done).toEqual(['a', 'b']);
    tick();
    expect(done).toEqual(['a', 'b', 'c', 'd']);
  });

  it('one heavy paint still goes through on its own', () => {
    const { queue, tick, advance } = harness(8);
    const done: string[] = [];
    queue.ask({}, () => {
      done.push('heavy');
      advance(40);
    });
    queue.ask({}, () => done.push('next'));
    tick();
    expect(done).toEqual(['heavy']);
    tick();
    expect(done).toEqual(['heavy', 'next']);
  });

  it('asking again for the same owner keeps one paint, the latest, in its first place', () => {
    const { queue, tick } = harness();
    const done: string[] = [];
    const a = {};
    queue.ask(a, () => done.push('a1'));
    queue.ask({}, () => done.push('b'));
    queue.ask(a, () => done.push('a2'));
    tick();
    expect(done).toEqual(['a2', 'b']);
  });

  it('says whether an owner still waits, and a cancelled paint never runs', () => {
    const { queue, tick } = harness();
    const done: string[] = [];
    const a = {};
    queue.ask(a, () => done.push('a'));
    expect(queue.waiting(a)).toBe(true);
    queue.cancel(a);
    expect(queue.waiting(a)).toBe(false);
    tick();
    expect(done).toEqual([]);
  });

  it('a paint that throws does not stop the ones after it', () => {
    const { queue, tick } = harness();
    const done: string[] = [];
    queue.ask({}, () => {
      throw new Error('no context');
    });
    queue.ask({}, () => done.push('b'));
    tick();
    expect(done).toEqual(['b']);
  });
});
