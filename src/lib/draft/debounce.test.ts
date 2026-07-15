import { describe, expect, it } from 'bun:test';
import { debounce } from './debounce';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('debounce', () => {
  it('coalesces a burst into one trailing call with the last args', async () => {
    let calls = 0;
    let last: number | undefined;
    const d = debounce((n: number) => {
      calls++;
      last = n;
    }, 20);
    d(1);
    d(2);
    d(3);
    expect(calls).toBe(0); // nothing fires synchronously
    await wait(40);
    expect(calls).toBe(1);
    expect(last).toBe(3);
  });

  it('cancel prevents a pending call', async () => {
    let calls = 0;
    const d = debounce(() => {
      calls++;
    }, 20);
    d();
    d.cancel();
    await wait(40);
    expect(calls).toBe(0);
  });
});
