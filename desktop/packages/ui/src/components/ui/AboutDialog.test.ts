import { describe, expect, test } from "vitest";

import { OPENCHAMBER_UPSTREAM_URL } from "./AboutDialog";

describe("AboutDialog", () => {
  test("links upstream attribution to the NOTICE OpenChamber source", () => {
    expect(OPENCHAMBER_UPSTREAM_URL).toBe("https://github.com/btriapitsyn/openchamber");
  });
});
