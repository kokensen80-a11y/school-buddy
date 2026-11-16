/** Minimal React test helpers for the UI kit tests (no testing library is installed). */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** Renders into a fresh container attached to the document and returns that container. */
export function render(ui: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(ui));
  return container;
}

/** Renders again into a container returned by `render`, to change props. */
export function rerender(container: HTMLElement, ui: ReactNode): void {
  const entry = mounted.find((item) => item.container === container);
  if (!entry) throw new Error('rerender: unknown container');
  act(() => entry.root.render(ui));
}

export function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

export function pressKey(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** Changes the value of a controlled input, textarea or select the way a user would. */
export function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('changeValue: element has no value setter');
  act(() => {
    setter.call(element, value);
    const type = element instanceof HTMLSelectElement ? 'change' : 'input';
    element.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

/** Lets pending promise callbacks and the React updates they cause settle. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Text of the element an ARIA id attribute (`aria-labelledby`, `aria-describedby`) points to. */
export function referencedText(element: Element, attribute: string): string | null {
  const id = element.getAttribute(attribute);
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`No element matches "${selector}"`);
  return element;
}

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}

interface NodeProcess {
  cwd(): string;
  getBuiltinModule(id: 'node:fs'): NodeFs;
}

// Vitest turns imported CSS into empty strings, so style sheets are read from disk.
// Node's fs is reached through `process` because the project has no Node typings.
const nodeProcess = (globalThis as unknown as { process: NodeProcess }).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

/** Reads a project file as text. The path is relative to the project root. */
export function readProjectFile(path: string): string {
  return fs.readFileSync(`${nodeProcess.cwd()}/${path}`, 'utf8');
}

/** Lists the file names in a project folder. The path is relative to the project root. */
export function listProjectDir(path: string): string[] {
  return fs.readdirSync(`${nodeProcess.cwd()}/${path}`);
}
