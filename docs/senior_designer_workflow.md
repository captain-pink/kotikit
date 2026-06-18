# Senior Designer Workflow

Kotikit's design track should model how a senior UX/UI designer works in a
team: create clear design intent, compose with the design system, invite
critique, make intentional refinements, communicate what changed, and preserve
project taste so the same feedback is not repeated forever.

## Core Loop

1. **Frame**
   - Understand the user, job, constraints, and success criteria.
   - Capture screens, states, edge cases, responsive behavior, and acceptance
     criteria in specs.

2. **Compose**
   - Build screens from synced design-system components whenever possible.
   - Apply project preferences before inventing new layout choices.
   - Keep generated Figma nodes mapped to plan steps so later feedback has a
     concrete target.

3. **Critique**
   - Read Figma comments without requiring a browser.
   - Map comments by Figma node ID when possible.
   - Keep comments outside known nodes visible as unmapped feedback, but do not
     guess context when the map is insufficient.

4. **Refine**
   - Make small, intentional adjustments.
   - Record each adjustment compactly with category, summary, optional comment
     ID, optional node ID, and optional preference evidence.

5. **Report**
   - Summarize the review pass: fetched comments, mapped comments, fixed items,
     unresolved decisions, unmapped comments, prepared replies, and posted
     replies.
   - Keep reports compact and queryable from SQLite rather than dumping a long
     history file into the agent context.

6. **Communicate**
   - Prepare Figma replies for fixed comments.
   - Post replies only when the user explicitly asks or a workflow flag clearly
     authorizes comment writes.
   - Do not delete comments as a substitute for resolving them.

7. **Learn**
   - Treat one comment as feedback.
   - Treat repeated similar feedback as a preference candidate.
   - Promote a candidate to an active project design preference only when the
     user confirms it or the rule is clearly intentional.

## Local Data Model

Kotikit stores review state in `.kotikit/design-review.db`.

- `review_sessions` records each comment-reading pass.
- `review_comments` stores compact comment rows and mapping status.
- `design_adjustments` stores micro-adjustments without bloating specs or
  prompts.
- `comment_outbox` stores pending and posted Figma replies.
- `design_preference_candidates` stores repeated feedback patterns.
- `design_preferences` stores active project rules used by future design work.

## Preference Rules

Preferences must be evidence-based and scoped.

Bad:

```text
User likes compact UI.
```

Good:

```text
For member-management tables, prefer compact row density.
Evidence: repeated density fixes on Members screens.
```

Active preferences are returned by `kotikit_design_get_screen` as
`designPreferences`, so agents can apply them before reviewers repeat the same
comments.

## Current Limitations

Figma's REST comments API supports reading comments and posting replies. It does
not currently provide a dedicated public "resolve comment" endpoint in the docs
kotikit uses. Kotikit therefore records fixed/replied state locally and can post
a reply such as "Fixed in this pass", but it does not pretend to resolve the
Figma thread itself.
