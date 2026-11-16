import { Component, act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exam } from '../../types';
import { createStoreHooks, type StoreHooks } from './hooks';
import {
  SAM,
  addSampleExam,
  createHarness,
  disposeHarnesses,
  resetBrowserStorage,
  signedInHarness,
  type Harness,
} from './testSupport';
import type { AppState } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetBrowserStorage();
  // React reports misuse of useSyncExternalStore (unstable snapshots, render loops) here.
  vi.spyOn(console, 'error');
  vi.spyOn(console, 'warn');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  disposeHarnesses();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

/** Renders a component that calls `useValue` and records every value it rendered with. */
function renderHook<T>(useValue: () => T): T[] {
  const rendered: T[] = [];
  function Probe(): null {
    rendered.push(useValue());
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return rendered;
}

class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ?? this.props.children;
  }
}

async function setup(): Promise<{ harness: Harness; hooks: StoreHooks; exam: Exam }> {
  const harness = await signedInHarness();
  const exam = await addSampleExam(harness);
  return { harness, hooks: createStoreHooks(harness.store), exam };
}

describe('store hooks', () => {
  it('follows the status from loading to signed in and out', async () => {
    const harness = createHarness();
    const { useAuthStatus } = createStoreHooks(harness.store);
    const rendered = renderHook(useAuthStatus);
    expect(rendered).toStrictEqual(['loading']);

    await act(() => harness.actions.init());
    await act(() => harness.actions.register(SAM));
    await act(() => harness.actions.logout());

    expect(rendered).toStrictEqual(['loading', 'signedOut', 'signedIn', 'signedOut']);
  });

  it('gives the account, or null when nobody is signed in', async () => {
    const harness = createHarness();
    const { useAccount } = createStoreHooks(harness.store);
    const rendered = renderHook(useAccount);

    await act(() => harness.actions.init());
    await act(() => harness.actions.register(SAM));

    expect(rendered[0]).toBeNull();
    expect(rendered.at(-1)).toBe(harness.store.getState().account);
    expect(rendered.at(-1)).toMatchObject({ name: 'Sam' });
  });

  it('gives each part of the data through its own hook', async () => {
    const { harness, hooks } = await setup();
    const { data } = harness.store.getState();
    const rendered = renderHook(() => ({
      data: hooks.useData(),
      exams: hooks.useExams(),
      sessions: hooks.useSessions(),
      subjects: hooks.useSubjects(),
      prefs: hooks.usePrefs(),
      warnings: hooks.useWarnings(),
      inbox: hooks.useInbox(),
    }));

    expect(rendered).toHaveLength(1);
    expect(rendered[0].data).toBe(data);
    expect(rendered[0].exams).toBe(data?.exams);
    expect(rendered[0].sessions).toBe(data?.sessions);
    expect(rendered[0].subjects).toBe(data?.subjects);
    expect(rendered[0].prefs).toBe(data?.prefs);
    expect(rendered[0].warnings).toBe(data?.warnings);
    expect(rendered[0].inbox).toBe(data?.inbox);
  });

  it('re-renders only the components whose part of the data changed', async () => {
    const { harness, hooks } = await setup();
    const exams = renderHook(hooks.useExams);
    const otherContainer = document.createElement('div');
    const otherRoot = createRoot(otherContainer);
    const subjects: unknown[] = [];
    function SubjectProbe(): null {
      subjects.push(hooks.useSubjects());
      return null;
    }
    act(() => otherRoot.render(createElement(SubjectProbe)));

    await act(() => harness.actions.addSubject({ name: 'Frans', color: 'pink' }));
    await act(() => harness.actions.updatePrefs({ sessionMinutes: 45 }));
    await act(() => harness.actions.toggleBlockedDate('2026-11-20'));

    expect(exams).toHaveLength(1);
    expect(subjects).toHaveLength(2);
    expect(subjects[1]).toBe(harness.store.getState().data?.subjects);
    act(() => otherRoot.unmount());
  });

  it('accepts a selector that builds a new object on every call', async () => {
    const { harness, hooks, exam } = await setup();
    const rendered = renderHook(() =>
      hooks.useAppState((state: AppState) => ({
        name: state.account?.name,
        examCount: state.data?.exams.length ?? 0,
      })),
    );
    expect(rendered).toStrictEqual([{ name: 'Sam', examCount: 1 }]);

    // Changes that leave the selected values alone do not re-render.
    await act(() => harness.actions.toggleBlockedDate('2026-11-20'));
    await act(() => harness.actions.updateExam(exam.id, { title: 'Andere titel' }));
    expect(rendered).toHaveLength(1);

    await act(() => harness.actions.deleteExam(exam.id));
    expect(rendered).toStrictEqual([
      { name: 'Sam', examCount: 1 },
      { name: 'Sam', examCount: 0 },
    ]);
  });

  it('accepts a selector that builds a new array on every call', async () => {
    const { harness, hooks, exam } = await setup();
    const rendered = renderHook(() =>
      hooks.useAppState((state) => (state.data?.exams ?? []).filter((item) => !item.grade)),
    );
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveLength(1);

    await act(() => harness.actions.toggleBlockedDate('2026-11-20'));
    expect(rendered).toHaveLength(1);

    await act(() => harness.actions.setGrade(exam.id, 8));
    expect(rendered).toHaveLength(2);
    expect(rendered[1]).toStrictEqual([]);
  });

  it('does not loop on a selector whose result is new at every level', async () => {
    const { harness, hooks, exam } = await setup();
    const rendered = renderHook(() =>
      hooks.useAppState((state) => ({
        open: (state.data?.exams ?? []).filter((item) => !item.grade),
      })),
    );
    expect(rendered).toHaveLength(1);
    expect(rendered[0].open).toHaveLength(1);

    await act(() => harness.actions.setGrade(exam.id, 8));

    expect(rendered).toHaveLength(2);
    expect(rendered[1].open).toStrictEqual([]);
  });

  it('uses the selector of the latest render, so a selector may depend on props', async () => {
    const { harness, hooks, exam } = await setup();
    const other = await addSampleExam(harness, { title: 'Tweede toets' });
    const titles: Array<string | undefined> = [];
    function Title({ id }: { id: string }): null {
      titles.push(hooks.useAppState((state) => state.data?.exams.find((e) => e.id === id)?.title));
      return null;
    }

    act(() => root.render(createElement(Title, { id: exam.id })));
    act(() => root.render(createElement(Title, { id: other.id })));
    await act(() => harness.actions.updateExam(other.id, { title: 'Hernoemd' }));

    expect(titles).toStrictEqual([exam.title, 'Tweede toets', 'Hernoemd']);
  });

  it('throws a clear error from the data hooks when nobody is signed in', async () => {
    const harness = createHarness();
    await harness.actions.init();
    const hooks = createStoreHooks(harness.store);
    const dataHooks = [
      hooks.useData,
      hooks.useExams,
      hooks.useSessions,
      hooks.useSubjects,
      hooks.usePrefs,
      hooks.useWarnings,
      hooks.useInbox,
    ];

    for (const useValue of dataHooks) {
      function Probe(): null {
        useValue();
        return null;
      }
      const errors: unknown[] = [];
      const probeRoot = createRoot(document.createElement('div'), {
        onCaughtError: (error) => errors.push(error),
      });
      act(() => probeRoot.render(createElement(Boundary, null, createElement(Probe))));
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toMatch(/needs a signed-in account/);
      act(() => probeRoot.unmount());
    }
  });

  it('lets a screen disappear cleanly when its account signs out', async () => {
    const { harness, hooks } = await setup();
    function ExamCount() {
      return createElement('span', null, `${hooks.useExams().length} toets`);
    }
    function App() {
      const status = hooks.useAuthStatus();
      return status === 'signedIn' ? createElement(ExamCount) : createElement('span', null, 'Log in');
    }
    const errors: unknown[] = [];
    const appRoot = createRoot(container.appendChild(document.createElement('div')), {
      onCaughtError: (error) => errors.push(error),
      onUncaughtError: (error) => errors.push(error),
    });

    act(() => appRoot.render(createElement(App)));
    expect(container.textContent).toBe('1 toets');
    await act(() => harness.actions.logout());

    expect(container.textContent).toBe('Log in');
    expect(errors).toStrictEqual([]);
    act(() => appRoot.unmount());
  });
});
