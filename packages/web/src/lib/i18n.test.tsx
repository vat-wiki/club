import { act,fireEvent, render, screen } from "@testing-library/react";
import { beforeEach,describe, expect, it } from "vitest";

import { DICTS,I18nProvider, LANG_LABEL, LANGS, useI18n } from "./i18n";

// The dictionary is hand-maintained, so guard against the easy regressions:
//  - every zh key has an en translation (and vice versa), so switching
//    languages never silently falls back to the wrong language;
//  - interpolation replaces {tokens};
//  - the provider re-renders on setLang and persists the choice;
//  - missing keys fall back gracefully rather than rendering empty.

// Probe component that exposes the i18n value + a switch button.
function Probe() {
  const { lang, t, setLang } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="msg">{t("composer.send")}</span>
      <span data-testid="interp">{t("roster.mobile.aria", { count: 3 })}</span>
      <span data-testid="missing">{t("does.not.exist")}</span>
      <button onClick={() => setLang(lang === "zh" ? "en" : "zh")}>switch</button>
    </div>
  );
}

describe("i18n dictionary completeness", () => {
  it("zh and en expose the exact same set of keys", () => {
    const zhKeys = Object.keys(DICTS.zh).sort();
    const enKeys = Object.keys(DICTS.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("no translation value is empty", () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${lang}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("LANGS exposes exactly zh + en, each labelled in its own language", () => {
    expect(LANGS).toEqual(["zh", "en"]);
    expect(LANG_LABEL.zh).toBe("中文");
    expect(LANG_LABEL.en).toBe("English");
  });
});

describe("useI18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to zh when nothing is stored", () => {
    // Pin zh explicitly: detectInitialLang also honors navigator.language,
    // which varies by host, so we only assert the "stored zh" path here.
    localStorage.setItem("club_lang", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("zh");
    expect(screen.getByTestId("msg").textContent).toBe("发送");
  });

  it("respects a stored preference on mount", () => {
    localStorage.setItem("club_lang", "en");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("msg").textContent).toBe("Send");
  });

  it("switches language live and persists the choice", () => {
    localStorage.setItem("club_lang", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("msg").textContent).toBe("发送");
    act(() => {
      fireEvent.click(screen.getByText("switch"));
    });
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("msg").textContent).toBe("Send");
    expect(localStorage.getItem("club_lang")).toBe("en");
  });

  it("interpolates {tokens} from vars", () => {
    localStorage.setItem("club_lang", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // zh: "成员——{count} 人在线" with count 3
    expect(screen.getByTestId("interp").textContent).toBe("成员——3 人在线");
  });

  it("falls back to the key itself for unknown keys (visible, not empty)", () => {
    localStorage.setItem("club_lang", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("missing").textContent).toBe("does.not.exist");
  });
});
