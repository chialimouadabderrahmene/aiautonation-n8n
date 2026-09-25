# Social autopilot — controlled rollout (human review first)

`AUTOPILOT_SOCIAL_POSTING` stays **`false`** until at least **one full week of human-reviewed output has passed**. Generated content is never posted without an approved draft or a passed safety check, but automation quality must be judged on real output before it is allowed to publish on brand accounts.

## Phase A — generate + review (week 1, posting OFF)
- Workflow 12 runs daily 09:00 (Lagos) and sends each platform's copy to Telegram for manual posting; workflow 01/02/10 handle the calendar-driven approval flow.
- Every day a human reviews **all** generated copy and records: accurate? on-brand (African foodstuff marketplace)? any invented statistic/testimonial/price? any medical/legal/financial claim? Track it in `Social Posts` (`status`, `flag_reason`) and a simple tally in the team chat.
- Exit criteria (suggested — set your own): 7 consecutive days, ≥ 95 % of posts usable without edits for accuracy, **zero** invented claims reaching a post, the safety net flagged what it should have, no duplicate posts.

## Phase B — one platform, approval still required
Enable a single platform's Buffer profile (`BUFFER_PROFILE_ID_<PLATFORM>`) and `AUTOPILOT_SOCIAL_POSTING=true`. Keep watching Telegram: every scheduled post must correspond to a reviewed row. Any wrong post → `AUTOPILOT_STOP=true` immediately.

## Phase C — remaining platforms
Add profiles one at a time. Workflow 10 (approved drafts) and 12 (autopilot copy) share the same Buffer account; TikTok has no API route and always stays manual.

## Safety net (what it catches)
Offensive words, absolute claims (`guaranteed`, `100%`, `proven to`, `always works`, `never fails`, `instant results`), medical/legal/financial promises, follow-for-follow hashtags, duplicate captions and empty captions → status `flagged`, reason in `flag_reason`, never auto-posted. It is a regex net, **not** a substitute for review; it cannot detect a wrong fact.

## Content rules baked into the prompts
Brand = a marketplace connecting African foodstuff vendors with buyers worldwide; no invented statistics, testimonials, prices, delivery promises or guarantees. If a prompt or post ever describes Eki as anything other than that marketplace (for example a business-automation product) that is a bug — report it.

## Rollback
`AUTOPILOT_STOP=true` (restart n8n) halts generation and posting; unpublish 10/12 to stop entirely; posted items must be deleted on the platform by a human.
