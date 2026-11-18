import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfirmProvider,
  Sheet,
  ToastProvider,
  useConfirm,
  useToast,
  type ConfirmFn,
  type ToastApi,
} from './index';
import { click, flush, pressKey, query, referencedText, render, rerender } from './testing';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('ToastProvider / useToast', () => {
  function setup(duration?: number): ToastApi {
    let api: ToastApi | undefined;
    function Probe() {
      api = useToast();
      return null;
    }
    render(
      <ToastProvider duration={duration}>
        <Probe />
      </ToastProvider>,
    );
    return api!;
  }

  it('announces a message politely in a pill at the top', () => {
    const toast = setup();
    const region = query(document.body, '.sb-toast-region');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    act(() => toast.success('Toets opgeslagen'));
    expect(query(region, '.sb-toast--success').textContent).toBe('Toets opgeslagen');
  });

  it('shows one toast at a time: a new one replaces the old one', () => {
    const toast = setup();
    act(() => toast.success('Eerste'));
    act(() => toast.error('Tweede'));
    const toasts = document.querySelectorAll('.sb-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].className).toContain('sb-toast--error');
    expect(toasts[0].textContent).toBe('Tweede');
  });

  it('dismisses itself after the duration, counted from the latest toast', () => {
    const toast = setup(3500);
    act(() => toast.info('Eerste'));
    advance(3000);
    act(() => toast.info('Tweede'));
    advance(3000);
    expect(query(document.body, '.sb-toast').textContent).toBe('Tweede');
    advance(500);
    expect(query(document.body, '.sb-toast').className).toContain('sb-toast--leaving');
    advance(256);
    expect(document.querySelector('.sb-toast')).toBeNull();
  });

  it('can be dismissed with a tap', () => {
    const toast = setup();
    act(() => toast.success('Klaar'));
    click(query(document.body, '.sb-toast'));
    advance(256);
    expect(document.querySelector('.sb-toast')).toBeNull();
  });

  it('keeps the same functions between renders', () => {
    const seen: ToastApi[] = [];
    function Probe() {
      seen.push(useToast());
      const [, setCount] = useState(0);
      return <button onClick={() => setCount((count) => count + 1)}>opnieuw</button>;
    }
    const container = render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    click(query(container, 'button'));
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('explains a missing provider', () => {
    function Probe() {
      useToast();
      return null;
    }
    const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ToastProvider/);
    silence.mockRestore();
  });
});

describe('Sheet', () => {
  function Harness({ onClose, open }: { onClose: () => void; open: boolean }) {
    return (
      <>
        <button id="opener">Open</button>
        <Sheet
          open={open}
          onClose={onClose}
          title="Leerstof bewerken"
          footer={<button id="save">Opslaan</button>}
        >
          <input id="first" aria-label="Onderdeel" />
        </Sheet>
      </>
    );
  }

  it('renders nothing while closed', () => {
    render(<Harness open={false} onClose={() => undefined} />);
    expect(document.querySelector('.sb-sheet')).toBeNull();
  });

  it('opens as a labelled modal dialog in a portal', () => {
    const container = render(<Harness open onClose={() => undefined} />);
    const dialog = query(document.body, '[role="dialog"]');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(referencedText(dialog, 'aria-labelledby')).toBe('Leerstof bewerken');
    expect(query(dialog, '.sb-sheet__body').contains(document.getElementById('first'))).toBe(true);
    expect(query(dialog, '.sb-sheet__footer').contains(document.getElementById('save'))).toBe(true);
  });

  it('closes on Escape, on the backdrop and on the close button', () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    pressKey(document.activeElement!, 'Escape');
    click(query(document.body, '.sb-sheet__backdrop'));
    click(query(document.body, 'button[aria-label="Sluiten"]'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('moves focus in, keeps Tab inside and gives focus back afterwards', () => {
    const container = render(<Harness open={false} onClose={() => undefined} />);
    const opener = query(container, '#opener');
    opener.focus();
    rerender(container, <Harness open onClose={() => undefined} />);
    const dialog = query(document.body, '[role="dialog"]');
    expect(document.activeElement).toBe(dialog);

    const close = query(dialog, 'button[aria-label="Sluiten"]');
    const save = query(dialog, '#save');
    pressKey(dialog, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(save);
    pressKey(save, 'Tab');
    expect(document.activeElement).toBe(close);

    rerender(container, <Harness open={false} onClose={() => undefined} />);
    expect(document.activeElement).toBe(opener);
  });

  it('locks page scroll while open', () => {
    const container = render(<Harness open onClose={() => undefined} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(container, <Harness open={false} onClose={() => undefined} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('stays mounted for the slide-out animation, then unmounts', () => {
    const container = render(<Harness open onClose={() => undefined} />);
    rerender(container, <Harness open={false} onClose={() => undefined} />);
    expect(query(document.body, '.sb-sheet').getAttribute('data-state')).toBe('closing');
    advance(256);
    expect(document.querySelector('.sb-sheet')).toBeNull();
  });

  it('lets only the top sheet react to Escape', () => {
    const closeLower = vi.fn();
    const closeUpper = vi.fn();
    render(
      <>
        <Sheet open onClose={closeLower} title="Onder">
          <p>Onder</p>
        </Sheet>
        <Sheet open onClose={closeUpper} title="Boven">
          <p>Boven</p>
        </Sheet>
      </>,
    );
    pressKey(document.activeElement!, 'Escape');
    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
  });
});

describe('ConfirmProvider / useConfirm', () => {
  function setup(): ConfirmFn {
    let confirm: ConfirmFn | undefined;
    function Probe() {
      confirm = useConfirm();
      return null;
    }
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    );
    return confirm!;
  }

  const ask = (confirm: ConfirmFn, options: Parameters<ConfirmFn>[0]) => {
    const answers: boolean[] = [];
    act(() => {
      void confirm(options).then((answer) => answers.push(answer));
    });
    return answers;
  };

  const buttonNamed = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.sb-sheet__footer button')].find(
      (button) => button.textContent === name,
    )!;

  it('asks the question in an alert dialog and resolves true on confirm', async () => {
    const answers = ask(setup(), {
      title: 'Toets verwijderen?',
      message: 'Dit kun je niet terugdraaien.',
      confirmLabel: 'Verwijderen',
    });
    const dialog = query(document.body, '[role="alertdialog"]');
    expect(dialog.textContent).toContain('Toets verwijderen?');
    expect(referencedText(dialog, 'aria-describedby')).toBe('Dit kun je niet terugdraaien.');
    expect(document.activeElement).toBe(buttonNamed('Verwijderen'));
    click(buttonNamed('Verwijderen'));
    await flush();
    expect(answers).toEqual([true]);
    advance(256);
    expect(document.querySelector('.sb-sheet')).toBeNull();
  });

  it('resolves false on cancel, Escape and backdrop', async () => {
    const confirm = setup();
    const first = ask(confirm, {
      title: 'Uitloggen?',
      confirmLabel: 'Uitloggen',
      cancelLabel: 'Blijven',
    });
    click(buttonNamed('Blijven'));
    await flush();
    const second = ask(confirm, { title: 'Uitloggen?', confirmLabel: 'Uitloggen' });
    pressKey(document.activeElement!, 'Escape');
    await flush();
    const third = ask(confirm, { title: 'Uitloggen?', confirmLabel: 'Uitloggen' });
    click(query(document.body, '.sb-sheet__backdrop'));
    await flush();
    expect([first, second, third]).toEqual([[false], [false], [false]]);
  });

  it('starts on the cancel button for a destructive action', () => {
    ask(setup(), { title: 'Alles wissen?', confirmLabel: 'Wissen', destructive: true });
    expect(document.activeElement).toBe(buttonNamed('Annuleren'));
    expect(buttonNamed('Wissen').className).toContain('sb-button--danger');
  });

  it('answers an open question with false when a new one is asked', async () => {
    const confirm = setup();
    const first = ask(confirm, { title: 'Eerste?', confirmLabel: 'Ja' });
    const second = ask(confirm, { title: 'Tweede?', confirmLabel: 'Ja' });
    await flush();
    expect(first).toEqual([false]);
    expect(query(document.body, '[role="alertdialog"]').textContent).toContain('Tweede?');
    click(buttonNamed('Ja'));
    await flush();
    expect(second).toEqual([true]);
  });
});
