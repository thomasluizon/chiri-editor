import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no type declarations
import { findSecrets, MASK, maskSecrets, projectSlug } from "../../scripts/export-sessions.mjs";

const FAKE = ["sk", "or", "v1", "0123456789abcdefABCDEF0123456789abcdef"].join("-"); // built at runtime, never a literal key

describe("session export masking", () => {
  it("masks key-shaped strings inside JSON lines and keeps every line valid JSON", () => {
    const line = JSON.stringify({ message: { content: `Authorization: Bearer ${FAKE} in a tool result` } });
    const { text, count } = maskSecrets(`${line}\n${line}`);
    expect(count).toBe(2);
    expect(text).not.toContain(FAKE);
    expect(text).toContain(MASK);
    for (const l of text.split("\n")) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("masks the exact known key even when it doesn't look like sk-or-", () => {
    const odd = "custom-gateway-token-1234567890";
    const { text } = maskSecrets(`key=${odd}`, [odd]);
    expect(text).toBe(`key=${MASK}`);
    expect(findSecrets(text, [odd])).toEqual([]);
  });

  it("leaves prose about the key format alone", () => {
    const prose = "grep for `sk-or-` and mask any match";
    expect(maskSecrets(prose).count).toBe(0);
  });

  it("finds leftovers by line number, and finds none after masking", () => {
    const text = `ok\nleak ${FAKE}\nok`;
    expect(findSecrets(text)).toEqual([2]);
    expect(findSecrets(maskSecrets(text).text)).toEqual([]);
  });

  it("derives the project folder name the way Claude Code does", () => {
    expect(projectSlug("/Users/a.b/Developer/chiri-editor")).toBe("-Users-a-b-Developer-chiri-editor");
  });
});
