import "@testing-library/jest-dom/vitest";

// jsdom does not implement layout-dependent APIs. MessageList auto-scrolls on
// new messages via Element.scrollIntoView; stub it so component tests that
// render messages don't blow up. (No-op is fine — tests don't assert scroll.)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom has no layout engine: @tanstack/react-virtual reads the scroll
// element's clientHeight to decide which rows are visible, and at 0 it renders
// nothing — so message-list tests would see zero rows. Give elements a
// non-zero viewport (and a stub ResizeObserver) so virtualized lists render
// fully in tests. Production layout is unaffected (this only runs under jsdom).
if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get: () => 800,
});