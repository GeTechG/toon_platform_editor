import { describe, expect, it } from 'bun:test';
import ru from './i18n/ru.json';
import en from './i18n/en.json';

// English is read by whoever's browser asks for it first. A key it lacks falls
// back to Russian mid-sentence on an English screen, and a lost `{{name}}`
// prints a hole — both caught here instead of by the reader.
type Tree = { [key: string]: string | Tree | (string | Tree)[] };

function flat(tree: Tree | (string | Tree)[], prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') out.set(prefix + key, value);
    else for (const [k, v] of flat(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

const PLURAL = /_(one|few|many|other)$/;
const slots = (text: string) => new Set([...text.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).filter((name) => name !== 'count'));

/** The keys English must have: a Russian plural (a base with two or more
 *  forms — `too_many` alone is a word, not a plural) asks for `_one` and `_other`. */
function wanted(source: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, text: string) => out.set(key, new Set([...(out.get(key) ?? []), ...slots(text)]));
  for (const [key, text] of source) {
    const base = key.replace(PLURAL, '');
    const forms = ['one', 'few', 'many', 'other'].filter((form) => source.has(`${base}_${form}`)).length;
    if (base !== key && forms > 1) for (const form of ['one', 'other']) add(`${base}_${form}`, text);
    else add(key, text);
  }
  return out;
}

export function compare(ruTree: Tree, enTree: Tree): string[] {
  const english = flat(enTree);
  const problems: string[] = [];
  for (const [key, need] of wanted(flat(ruTree))) {
    const text = english.get(key);
    if (text === undefined) problems.push(`missing ${key}`);
    else for (const name of need) if (!slots(text).has(name)) problems.push(`${key} lost {{${name}}}`);
  }
  return problems;
}

describe('the English catalogue', () => {
  it('says everything the Russian one says, with the same slots', () => {
    expect(compare(ru as Tree, en as Tree)).toEqual([]);
  });
});
