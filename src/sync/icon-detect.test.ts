import { describe, it, expect } from "bun:test";
import { detectIconSignal } from "./icon-detect.js";

describe("detectIconSignal", () => {
  // ── page signal
  it("detects 'Icons' page", () => {
    expect(detectIconSignal({ pageName: "Icons", componentName: "ArrowLeft" })).toBe("page");
  });

  it("detects 'Icon' page (singular)", () => {
    expect(detectIconSignal({ pageName: "Icon", componentName: "X" })).toBe("page");
  });

  it("matches page case-insensitively", () => {
    expect(detectIconSignal({ pageName: "ICONS", componentName: "X" })).toBe("page");
  });

  it("does not match a partial page name like 'Iconography'", () => {
    expect(detectIconSignal({ pageName: "Iconography", componentName: "X" })).toBe(null);
  });

  // ── prefix signal
  it("detects 'ic_arrow' prefix", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "ic_arrow" })).toBe("prefix");
  });

  it("detects 'ic-arrow' prefix", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "ic-arrow" })).toBe("prefix");
  });

  it("detects '.icon' suffix", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "arrow.icon" })).toBe("prefix");
  });

  it("does NOT misdetect 'icebox' as prefix", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "icebox" })).toBe(null);
  });

  it("does NOT misdetect 'Iconography' as prefix", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "Iconography" })).toBe(null);
  });

  // ── slash signal
  it("detects 'Icon/Arrow' slash", () => {
    expect(detectIconSignal({ pageName: "Foundation", componentName: "Icon/Arrow" })).toBe("slash");
  });

  it("detects 'Icons/Arrow/Left' slash", () => {
    expect(detectIconSignal({ pageName: "Foundation", componentName: "Icons/Arrow/Left" })).toBe("slash");
  });

  // ── precedence: page > prefix > slash
  it("page wins over prefix on multi-match", () => {
    expect(detectIconSignal({ pageName: "Icons", componentName: "ic_arrow" })).toBe("page");
  });

  it("page wins over slash on multi-match", () => {
    expect(detectIconSignal({ pageName: "Icons", componentName: "Icon/Arrow" })).toBe("page");
  });

  it("slash signal fires for 'icon/arrow' (prefix regex does not include slash)", () => {
    // "icon/arrow" has no ic[-_] or icon_ prefix, so it falls through to the slash signal
    expect(detectIconSignal({ pageName: "Components", componentName: "icon/arrow" })).toBe("slash");
  });

  // ── negative
  it("returns null when none of the signals fire", () => {
    expect(detectIconSignal({ pageName: "Components", componentName: "Button" })).toBe(null);
  });
});
