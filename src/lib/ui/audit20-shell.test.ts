import { describe, expect, it } from 'bun:test';

// Двадцатый аудит, оболочка студии. Editor.svelte проверяется как исходник,
// как в audit19-shell.test.ts.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('трек пишется в запись своего черновика', () => {
  it('смена черновика сама трек не пишет: пока трек открытого читался, в его запись уходил трек прежнего', () => {
    // Эффект слышал draftId; открыт черновик с треком — в руке ещё прежний
    // трек (чтение асинхронное), и он писался в новую запись.
    expect(editorUi).toMatch(/void setDraftAudio\(\s*(?:\/\/.*\s*)*untrack\(\(\) => draftId\),/);
    expect(editorUi).not.toMatch(/setDraftAudio\(\s*draftId,/);
  });
});

describe('уход под замком трансформации', () => {
  it('pagehide пишет черновик со сдвигом: замок не дал применить, и запись со сдвигом из фона затиралась рисунком без него', () => {
    expect(editorUi).toMatch(/onpagehide=\{[^}]*editor\.leaveTransform\(\);\s*flushOnHide\(\)/);
  });

  it('уход из студии по ссылке сайта — тоже', () => {
    const destroy = editorUi.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/)?.[0] ?? '';
    expect(destroy).toMatch(/editor\.leaveTransform\(\);\s*flushOnHide\(\);[^]*editor\.audio\.clear\(\)/);
  });

  it('без живого сдвига запись прежняя: flushOnHide уходит в flushOnLeave', () => {
    expect(fn('flushOnHide')).toMatch(/if \(shown !== editor\.doc\) \{[^]*?return;\s*\}\s*flushOnLeave\(\);/);
  });
});

describe('файл поверх рисунка, который браузер не хранит', () => {
  it('спрашивает ещё раз, когда об этом узнала только запись перед заменой: вопрос обещал замену, а не потерю', () => {
    const open = fn('openFile');
    // Запись при заблокированном хранилище отвечает «успех» и ставит storageBlocked.
    expect(fn('saveNow')).toMatch(/ok && bytes === 0[^]*?storageBlocked = true;[^]*?return true;/);
    expect(open).toMatch(
      /if \(!\(await saveNow\(true\)\)\) \{\s*return;\s*\}\s*(?:\/\/.*\s*)*if \(storageBlocked && question !== 'editor\.file_open_lost_confirm' && !confirm\(t\('editor\.file_open_lost_confirm', \{ name: file\.name \}\)\)\) \{\s*return;/,
    );
  });
});
