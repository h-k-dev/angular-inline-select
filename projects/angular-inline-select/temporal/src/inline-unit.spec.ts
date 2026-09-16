import { focusInputNearPoint, isUnitSpacePress } from './inline-unit';

function input(
  value: string,
  rect?: { left: number; width: number; top?: number; height?: number },
) {
  const el = document.createElement('input');
  el.value = value;
  document.body.appendChild(el);
  if (rect) {
    const { left, width, top = 0, height = 20 } = rect;
    el.getBoundingClientRect = () =>
      ({ left, width, top, height, right: left + width, bottom: top + height }) as DOMRect;
  }
  return el;
}

describe('focusInputNearPoint', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('without layout the first input takes it, caret at the end', () => {
    const [a, b] = [input('12.05.2026'), input('13.05.2026')];

    expect(focusInputNearPoint([a, b], 500, 5)).toBe(a);
    expect(document.activeElement).toBe(a);
    expect(a.selectionStart).toBe(10);
  });

  it('the nearest input by box takes it — before it lands at the start, past it at the end', () => {
    const start = input('12.05.2026', { left: 100, width: 80 });
    const end = input('13.05.2026', { left: 200, width: 80 });

    expect(focusInputNearPoint([start, end], 10, 10)).toBe(start);
    expect(start.selectionStart).toBe(0);

    expect(focusInputNearPoint([start, end], 300, 10)).toBe(end);
    expect(end.selectionStart).toBe(10);
  });

  it('inside the box the caret lands proportionally (digits are near-monospace)', () => {
    const el = input('12.05.2026', { left: 100, width: 100 });

    focusInputNearPoint([el], 150, 40); // below the box, at its middle
    expect(el.selectionStart).toBe(5);
  });

  it('skips disabled inputs and undefined sides', () => {
    const start = input('a', { left: 100, width: 80 });
    start.disabled = true;
    const end = input('b', { left: 200, width: 80 });

    expect(focusInputNearPoint([undefined, start, end], 10, 10)).toBe(end);
    expect(focusInputNearPoint([start], 10, 10)).toBeNull();
  });
});

describe('isUnitSpacePress', () => {
  function unitWith(inner: string) {
    const unit = document.createElement('span');
    unit.innerHTML = inner;
    document.body.appendChild(unit);
    return unit;
  }

  function press(target: Element, init: MouseEventInit = {}) {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("the unit's own space and non-interactive affixes count; inputs and chrome do not", () => {
    const unit = unitWith('<span class="affix">€</span><input /><button>📅</button>');
    let seen: boolean | null = null;
    unit.addEventListener('mousedown', (event) => (seen = isUnitSpacePress(event, unit)));

    press(unit);
    expect(seen).toBe(true);
    press(unit.querySelector('.affix')!);
    expect(seen).toBe(true);
    press(unit.querySelector('input')!);
    expect(seen).toBe(false);
    press(unit.querySelector('button')!);
    expect(seen).toBe(false);
  });

  it('shift-presses and non-primary buttons are left alone', () => {
    const unit = unitWith('');
    let seen: boolean | null = null;
    unit.addEventListener('mousedown', (event) => (seen = isUnitSpacePress(event, unit)));

    press(unit, { shiftKey: true });
    expect(seen).toBe(false);
    press(unit, { button: 2 });
    expect(seen).toBe(false);
  });
});
