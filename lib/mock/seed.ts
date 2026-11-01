import type { Suggestion } from "@/lib/types";

/** Static content for the design mock. Removed once the AI is wired up. */
export const seedDoc = `# Q3 launch update

We are pleased to share that, after a great deal of work across several teams over the past quarter, the new onboarding flow is now live for all customers as of this Monday.

## What changed

New accounts now land on a three-step checklist instead of the old settings page. In the first week, 64% of new teams finished setup, up from 41% before the change. Teams that finished setup were also far more likely to invite a second person.

We also simplified the billing step. Billing was, in many ways, one of the most confusing parts of the old flow, and it was something that a lot of people found confusing.

## What's next

- Roll the checklist out to existing workspaces
- Add an **import from CSV** option to step two
- Track _time to first invite_ as the main success metric

> If anything in the new flow looks off, post in \`#onboarding\` and we'll take a look.

Thanks to everyone who helped get this out the door. The full results are on the [team page](https://example.com/onboarding).
`;

type SeedEdit = { quote: string; replacement: string; reason: string; /** text right after an insert point */ before?: string };

const seedEdits: SeedEdit[] = [
  {
    quote: "We are pleased to share that, after a great deal of work across several teams over the past quarter, the",
    replacement: "The",
    reason: "Lead with the news. The effort behind it can come later, if at all.",
  },
  {
    quote: ", and it was something that a lot of people found confusing",
    replacement: "",
    reason: "Says the first half of the sentence again.",
  },
  {
    quote: "",
    before: "\n- Add an **import",
    replacement: " in October",
    reason: "Give the rollout a date so other teams can plan around it.",
  },
];

/** Place seed edits the way the server will: by exact, unique match. */
export function seedSuggestions(doc: string): Suggestion[] {
  return seedEdits.map((e, i) => {
    const needle = e.quote || e.before!;
    const at = doc.indexOf(needle);
    if (at < 0 || doc.indexOf(needle, at + 1) >= 0) throw new Error(`seed edit ${i} is not unique`);
    return { id: `s${i + 1}`, from: at, to: at + e.quote.length, quote: e.quote, replacement: e.replacement, reason: e.reason };
  });
}
