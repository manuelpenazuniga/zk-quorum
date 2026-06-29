/**
 * Tiny DOM-render helper so we do not need a framework. Each app is a single
 * page that mounts a `Root` and listens for events. The only allowed
 * dependencies are `@zk-quorum/protocol` and the local adapters.
 */
export type EventMap = Record<string, EventListener>;

export interface Component<P> {
  (props: P): HTMLElement;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Partial<Record<string, string>> = {}, children: Array<Node | string> = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children) {
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function mount(target: HTMLElement, node: Node): void {
  target.replaceChildren(node);
}

export function on<K extends keyof HTMLElementEventMap>(el: HTMLElement, ev: K, listener: (e: HTMLElementEventMap[K]) => void): void {
  el.addEventListener(ev, listener);
}
