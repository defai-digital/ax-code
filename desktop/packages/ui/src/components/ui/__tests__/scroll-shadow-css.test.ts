// @vitest-environment node
// Reads source files relative to import.meta.url, which must be a file:// URL.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const indexCss = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
const mainLayoutSource = readFileSync(new URL("../../layout/MainLayout.tsx", import.meta.url), "utf8");
const toolRevealSource = readFileSync(new URL("../../chat/message/parts/ToolRevealOnMount.tsx", import.meta.url), "utf8");

function getScrollShadowCss() {
  const start = indexCss.indexOf('/* Scroll shadow fallback without CSS masks');
  const end = indexCss.indexOf("@keyframes spin-once", start);

  expect(start >= 0).toBe(true);
  expect(end > start).toBe(true);

  return indexCss.slice(start, end);
}

describe("scroll shadow css", () => {
  test("does not use CSS masks for scroll shadows", () => {
    const scrollShadowCss = getScrollShadowCss();

    expect(scrollShadowCss).not.toContain("mask-image");
    expect(scrollShadowCss).not.toContain("-webkit-mask-image");
    expect(scrollShadowCss).toContain("box-shadow");
  });

  test("does not use CSS masks in known Electron rendering risk paths", () => {
    expect(indexCss).not.toContain("mask-image");
    expect(indexCss).not.toContain("-webkit-mask-image");
    expect(mainLayoutSource).not.toContain("maskImage");
    expect(mainLayoutSource).not.toContain("WebkitMaskImage");
    expect(toolRevealSource).not.toContain("maskImage");
    expect(toolRevealSource).not.toContain("webkitMaskImage");
  });
});
