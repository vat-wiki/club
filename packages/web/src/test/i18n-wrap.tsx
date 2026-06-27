import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { I18nProvider, type Lang } from "@/lib/i18n";

// Test helper: render a component inside <I18nProvider> so useT()/useI18n()
// resolve. Any component that consumes the dictionary must be mounted within
// the provider; these helpers keep test bodies free of boilerplate and pin a
// deterministic language (zh by default) so assertions don't depend on the
// host browser's navigator.language.

interface RenderI18nOptions extends RenderOptions {
  lang?: Lang;
}

export function renderWithI18n(ui: ReactNode, { lang, ...opts }: RenderI18nOptions = {}) {
  if (lang) {
    // Persist the requested language so detectInitialLang() picks it up.
    localStorage.setItem("club_lang", lang);
  } else {
    // Default to zh for deterministic assertions unless a test opts into en.
    localStorage.setItem("club_lang", "zh");
  }
  return render(<I18nProvider>{ui}</I18nProvider>, opts);
}

// Wrap arbitrary JSX in the provider without rendering — useful for the axe
// helpers that need to inject the result into document.body themselves.
export function withI18n(ui: ReactNode, lang: Lang = "zh"): ReactNode {
  localStorage.setItem("club_lang", lang);
  return <I18nProvider>{ui}</I18nProvider>;
}
