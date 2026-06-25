import "@testing-library/jest-dom/vitest";

// jsdom does not implement layout-dependent APIs. MessageList auto-scrolls on
// new messages via Element.scrollIntoView; stub it so component tests that
// render messages don't blow up. (No-op is fine — tests don't assert scroll.)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}