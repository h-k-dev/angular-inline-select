import { signal } from '@angular/core';

import { makeSideCore } from './side-session';

// =============================================================================
// The draft clamp (22.1 custom set): a write through the draft's setter IS
// user input and marks the side dirty in the same synchronous step — no call
// site can write a draft and forget the flag. `restore()` is the one
// non-user write.
// =============================================================================

describe('makeSideCore — the draft/dirty clamp', () => {
  function core() {
    const display = signal('committed');
    const side = makeSideCore<string>('start', signal(null), display);
    side.open.set(true); // freeze the draft, as a session would
    return { side, display };
  }

  it('a draft write marks the side dirty synchronously', () => {
    const { side } = core();
    expect(side.dirty()).toBe(false);

    side.draft.set('typed');

    expect(side.draft()).toBe('typed');
    expect(side.dirty()).toBe(true);
  });

  it('restore() re-renders the committed display WITHOUT marking dirty', () => {
    const { side } = core();
    side.draft.set('typed');
    side.dirty.set(false); // the session boundary's explicit reset

    side.restore();

    expect(side.draft()).toBe('committed');
    expect(side.dirty()).toBe(false);
  });

  it('a source-driven reset (session closed, display flows) never marks dirty', () => {
    const { side, display } = core();
    side.open.set(false);

    display.set('externally moved');

    expect(side.draft()).toBe('externally moved');
    expect(side.dirty()).toBe(false);
  });

  describe('the live-channel hook (onUserWrite)', () => {
    function hooked() {
      const display = signal('committed');
      const writes: string[] = [];
      const side = makeSideCore<string>('start', signal(null), display, () => {
        writes.push(side.draft());
      });
      side.open.set(true);
      return { side, display, writes };
    }

    it('fires on a USER write, synchronously, with the new draft in place', () => {
      const { side, writes } = hooked();

      side.draft.set('typed');

      expect(writes).toEqual(['typed']);
      expect(side.dirty()).toBe(true); // dirty is marked BEFORE the hook runs
    });

    it('restore() never fires it', () => {
      const { side, writes } = hooked();
      side.draft.set('typed');

      side.restore();

      expect(writes).toEqual(['typed']);
      expect(side.draft()).toBe('committed');
    });

    it('a source-driven reset never fires it', () => {
      const { side, display, writes } = hooked();
      side.open.set(false);

      display.set('externally moved');

      expect(writes).toEqual([]);
    });
  });
});
