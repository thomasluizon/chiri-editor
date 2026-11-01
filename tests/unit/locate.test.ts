import { describe, expect, it } from "vitest";
import { locateEdits, sharedEnds } from "@/lib/server/locate";
import { suggest, SuggestError } from "@/lib/server/suggest";

const edit = (quote: string, replacement: string, reason = "r") => ({ quote, replacement, reason });

describe("SPEC 7.1: placing quotes (locateEdits)", () => {
  it("1. a quote that appears once is placed at the correct from/to", () => {
    const doc = "Alpha beta gamma.";
    const { placed, dropped } = locateEdits(doc, [edit("beta", "delta")]);
    expect(dropped).toEqual([]);
    expect(placed).toEqual([{ from: 6, to: 10, quote: "beta", replacement: "delta", reason: "r" }]);
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("beta");
  });

  it("2. a quote that appears 0 times is dropped as not_found", () => {
    const { placed, dropped } = locateEdits("Alpha beta gamma.", [edit("epsilon", "zeta")]);
    expect(placed).toEqual([]);
    expect(dropped).toEqual([{ quote: "epsilon", why: "not_found" }]);
  });

  it("3. a quote that appears 2 times is dropped as ambiguous", () => {
    const { placed, dropped } = locateEdits("the cat and the dog", [edit("the", "a")]);
    expect(placed).toEqual([]);
    expect(dropped).toEqual([{ quote: "the", why: "ambiguous" }]);
  });

  it("3b. overlapping occurrences also count as ambiguous", () => {
    const { dropped } = locateEdits("aaa", [edit("aa", "b")]);
    expect(dropped).toEqual([{ quote: "aa", why: "ambiguous" }]);
  });

  it("4. a quote twice in the doc but once inside scope is placed inside the scope", () => {
    const doc = "Fix this now.\n\nFix this now.";
    const scope = { from: 15, to: doc.length };
    const { placed, dropped } = locateEdits(doc, [edit("this now", "it today")], scope);
    expect(dropped).toEqual([]);
    expect(placed).toHaveLength(1);
    expect(placed[0].from).toBe(19);
    expect(placed[0].from).toBeGreaterThanOrEqual(scope.from);
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("this now");
  });

  it("5. a quote that's only outside the scope is dropped as outside_scope", () => {
    const doc = "First paragraph here.\n\nSecond one.";
    const { placed, dropped } = locateEdits(doc, [edit("First", "Opening")], { from: 23, to: doc.length });
    expect(placed).toEqual([]);
    expect(dropped).toEqual([{ quote: "First", why: "outside_scope" }]);
  });

  it("6. two overlapping edits: the first is kept, the second dropped as overlap", () => {
    const doc = "The quick brown fox jumps.";
    const { placed, dropped } = locateEdits(doc, [edit("quick brown", "fast red"), edit("brown fox", "brown cat")]);
    expect(placed.map((p) => p.quote)).toEqual(["quick brown"]);
    expect(dropped).toEqual([{ quote: "brown fox", why: "overlap" }]);
  });

  it("7. replacement === quote is dropped as noop", () => {
    const { placed, dropped } = locateEdits("Keep this.", [edit("Keep this.", "Keep this.")]);
    expect(placed).toEqual([]);
    expect(dropped).toEqual([{ quote: "Keep this.", why: "noop" }]);
  });

  it('8. trimming: "The cat sat." → "The black cat sat." becomes an insertion of "black "', () => {
    const doc = "Intro. The cat sat. Outro.";
    const { placed } = locateEdits(doc, [edit("The cat sat.", "The black cat sat.")]);
    const at = doc.indexOf("cat sat");
    expect(placed).toEqual([{ from: at, to: at, quote: "", replacement: "black ", reason: "r" }]);
  });

  it("8b. trimming snaps to word boundaries (colour → color stays a whole-word change)", () => {
    expect(sharedEnds("the colour red", "the color red")).toEqual({ prefix: 4, suffix: 4 });
    const doc = "Pick the colour red.";
    const { placed } = locateEdits(doc, [edit("the colour red", "the color red")]);
    expect(placed[0]).toMatchObject({ quote: "colour", replacement: "color" });
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("colour");
  });

  it("9. offsets are correct when emoji and accented characters come before the quote (UTF-16)", () => {
    const doc = "😀 Café — naïve 👩🏽‍💻 notes: fix teh typo.";
    const { placed } = locateEdits(doc, [edit("teh", "the")]);
    expect(placed[0].from).toBe(doc.indexOf("teh"));
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("teh");
  });

  it("9b. trimming never splits an emoji's surrogate pair", () => {
    const doc = "I 😀 it";
    const { placed } = locateEdits(doc, [edit("I 😀 it", "I 😃 it")]);
    expect(placed[0]).toMatchObject({ quote: "😀", replacement: "😃" });
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("😀");
  });

  it("10. a sixth edit from a misbehaving model is rejected by validation (max 5)", async () => {
    const six = Array.from({ length: 6 }, (_, i) => edit(`w${i}`, `x${i}`));
    const fakeFetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ note: "n", edits: six }) } }] }));
    const run = suggest(
      { mode: "suggest", doc: "w0 w1 w2 w3 w4 w5" },
      { apiKey: "k", model: "m", fetch: fakeFetch as typeof fetch },
    );
    await expect(run).rejects.toBeInstanceOf(SuggestError);
    await expect(run).rejects.toMatchObject({ status: 502 });
  });
});

describe("refine widens a fragment to whole sentences", () => {
  const doc = "# T\n\nNew accounts land on a checklist. In the first week, 64% finished setup, up from 41% before the change. Teams invited more.\n\n- An item.";

  it("a mid-phrase span grows to its sentence", async () => {
    const { sentencesAround } = await import("@/lib/server/suggest");
    const from = doc.indexOf("the first week");
    const r = sentencesAround(doc, { from, to: doc.indexOf(" before") });
    expect(doc.slice(r.from, r.to)).toBe("In the first week, 64% finished setup, up from 41% before the change.");
  });

  it("a span across two sentences covers both; a list item stays within its line", async () => {
    const { sentencesAround } = await import("@/lib/server/suggest");
    const r = sentencesAround(doc, { from: doc.indexOf("checklist"), to: doc.indexOf("first") });
    expect(doc.slice(r.from, r.to)).toBe("New accounts land on a checklist. In the first week, 64% finished setup, up from 41% before the change.");
    const li = sentencesAround(doc, { from: doc.indexOf("item"), to: doc.indexOf("item") });
    expect(doc.slice(li.from, li.to)).toBe("- An item.");
  });

  it("the model sees the whole sentence with the current suggestion applied, and the result is trimmed back", async () => {
    const from = doc.indexOf("the first week");
    const to = doc.indexOf(" before");
    let prompt = "";
    const fakeFetch = async (_url: unknown, init?: RequestInit) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
      const replacement = "During the first week, 64% completed setup, up from 41% before the change.";
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ note: "n", replacement, reason: "r" }) } }] }));
    };
    const res = await suggest(
      {
        mode: "refine",
        doc,
        instruction: "more formal",
        target: { from, to, quote: doc.slice(from, to), replacement: "its first week, 64% finished setup, up from 41%", history: [] },
      },
      { apiKey: "k", model: "m", fetch: fakeFetch as typeof fetch },
    );
    expect(prompt).toContain("<original>In the first week, 64% finished setup, up from 41% before the change.</original>");
    expect(prompt).toContain("In its first week, 64% finished setup, up from 41% before the change.");
    const s = res.suggestions[0];
    const applied = doc.slice(0, s.from) + s.replacement + doc.slice(s.to);
    expect(applied).toContain("checklist. During the first week, 64% completed setup, up from 41% before the change. Teams");
    expect(s).toMatchObject({ quote: "In the first week, 64% finished", replacement: "During the first week, 64% completed" });
  });
});

describe("review fixes: placement", () => {
  it("R7. trimming keeps a decomposed accent with its letter (é = e + U+0301)", () => {
    const quote = "café x"; // "café x" as macOS/PDF text often stores it
    const replacement = "cafè x"; // "cafè x"
    const doc = `Order a ${quote} now.`;
    const { placed } = locateEdits(doc, [edit(quote, replacement)]);
    expect(placed[0]).toMatchObject({ quote: "café", replacement: "cafè" });
    expect(doc.slice(placed[0].from, placed[0].to)).toBe("café");
  });
});
