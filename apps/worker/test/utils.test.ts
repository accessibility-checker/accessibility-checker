import { describe, expect, it } from "vitest";
import { validateScanRequest } from "../src/utils";

describe("validateScanRequest", () => {
  it("accepts a public https URL", () => {
    const result = validateScanRequest({
      url: "https://example.com",
      standard: "wcag22aa"
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects localhost", () => {
    const result = validateScanRequest({
      url: "http://localhost:3000",
      standard: "wcag22aa"
    });

    expect(result.ok).toBe(false);
  });

  it("rejects unsupported standards", () => {
    const result = validateScanRequest({
      url: "https://example.com",
      standard: "wcag21aa" as "wcag22aa"
    });

    expect(result.ok).toBe(false);
  });
});
