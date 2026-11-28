# SkyStats: UK compliance rules and the 250-idea build plan

This is the rulebook for building the rest of the ideas list (`STUFF.txt`) in a way that fits UK law and the Hypixel API policy. It is not legal advice. Have a solicitor check the privacy notice, terms and the launch checklist before taking money.

## 1. What changed in phase 1, and why

| Rule | Where it comes from | What we did |
|---|---|---|
| No polling the Hypixel API to build stat histories or session tracking | Hypixel API policy ("Data collection and polling") | Removed the active-player cron and the heartbeat-triggered lookups. Money history now comes only from the mod (`POST /v1/mod/snapshot`). Profile lookups are on demand and cached for 60 minutes. Old API-sourced snapshots are labelled `hypixel_api` and never shown. |
| Paid content from the API must be transformative; a free tier is required; no gambling | Hypixel API policy ("Monetization") | Paid tiers gate mod-recorded history, rollups and computed methods, not raw API data. Free tier stays. No betting features. |
| Don't build projects to track specific players; don't de-anonymise | Hypixel API policy ("Game integrity") | `/v1/players/{name}` and `/profile` only show opted-in players, never trigger a Hypixel lookup, and give the same answer for private and unknown names. |
| High privacy by default, profiling off, no nudges | ICO Children's Code (many SkyBlock players are under 18) | Public profile, leaderboards and co-op pings default off; coins hidden from co-op by default; no upgrade pressure. |
| Access, portability, erasure; accountability | UK GDPR Articles 5(2), 15, 17, 20 | `/settings`: download everything as JSON, delete account (cancels billing first). Append-only `audit_log`. |
| Storage limitation | UK GDPR Article 5(1)(e) | Tier retention job (7/90/unlimited days) with a 30-day soft window; orphan history removed; off-site backups expire after 30 days. |
| Security of processing | UK GDPR Article 32 | Off-site backups encrypted with `age`; the copy is refused without a recipient key. |
| Cookies | PECR regulation 6 | Only `ss_session`, which is strictly necessary, so no banner. |
| Clear pre-contract info, 14-day cancellation, total price | Consumer Contracts Regulations 2013; DMCC Act 2024 | Pricing and checkout state VAT-inclusive totals, auto-renewal, easy cancellation and the 14-day refund. Checkout requires agreeing to the terms. |
| No direct exhortation to children to buy; no aggressive practices | DMCC Act 2024 Schedule 20 (banned practices) | No countdowns, "upgrade now" pushes or retention-expiry prompts. Plans are a plain comparison page. |
| Not an official Minecraft service | Minecraft Usage Guidelines | Disclaimer in the footer and terms. |

## 2. Before launch: things only you can do

- [ ] Fill in `web/src/lib/legal.ts`: controller name, contact email, geographic address. Both UK GDPR and consumer law require these.
- [ ] Pay the ICO data protection fee and add the registration number.
- [ ] Write a Data Protection Impact Assessment. The Children's Code expects one for services likely to be used by children. The ICO has a template.
- [ ] VAT: if you aren't VAT-registered, change "Prices include VAT" in the pricing page and terms to the accurate wording. If you are, turn on Stripe Tax.
- [ ] Stripe dashboard: customer portal set to "cancel at end of period" and to allow plan changes. Webhook endpoint `https://api.skystats.cc/v1/billing/stripe-webhook` with the `checkout.session.completed`, `customer.subscription.*` and `invoice.payment_failed` events.
- [ ] The 14-day refund promise: decide who issues refunds and how fast. Until it's automated, refund from the Stripe dashboard when someone cancels within 14 days.
- [ ] The DMCC subscription regime is expected in January 2027. Yearly plans and free trials will need renewal reminders and renewal cooling-off. Don't launch yearly plans or trials (ideas 134, 216) until those reminders exist.
- [ ] Hypixel: register the app as a production application and describe the monetisation model. Ask whether bazaar price history behind Pro/Max counts as transformative, or keep raw bazaar history free and only paywall computed insight.
- [ ] Age-check Stripe's own rules: Stripe accounts and cards need adults. The site tells under-18s to ask a parent or carer.
- [ ] Generate an `age` key pair for backups. Store the private key off the laptop.

## 3. Rules for every new feature

1. **Data source.** Player data over time must come from the player's own mod. The Hypixel API may be used on demand, for the signed-in player or their co-op, cached for at least 60 minutes. Bazaar, auctions, election and resources endpoints are fine to poll.
2. **Social features are opt-in.** Anything that shows one player's data to others checks a privacy flag that defaults to off. New flags go in `accounts` with `default(false)`.
3. **Gate with `FEATURES`.** Add the feature to `server/src/modules/entitlements/tiers.ts` and call `entitlementsService.require()`. Alerts and DMs are Pro and above, except Hypixel outage and SkyBlock patch notices, which stay free.
4. **No profiling by default.** Inferences about a player (activity classifier, "methods for me") are off until the player turns them on.
5. **No gambling.** No stakes, no paid entry, no prizes with money value for prediction or guessing games.
6. **No user-written public text without an Online Safety Act review.** Comments, shared method descriptions or chat make SkyStats a user-to-user service, which needs illegal-content and children's risk assessments plus reporting tools. Votes and star ratings are fine.
7. **Messages.** Discord DMs and email need opt-in. Marketing email needs consent under PECR; receipts and security notices don't.
8. **Promotions.** Creator codes need creators to label posts as ads (ASA CAP Code).
9. **Exports and erasure.** New tables holding personal data must be added to `privacyRepo.exportAll` and `privacyRepo.erase`, and to the retention job if they hold history.
10. **Audit.** Billing, privacy and admin actions call `audit.log()`.

## 4. Phase plan

Numbers match the ideas doc. The bot list follows `STUFF.txt`, so bot ideas 40, 41 and 48–55 from the original doc are out of scope.

### Phase 1: done on `feat/phase1-uk-compliance` branches

| Area | Ideas |
|---|---|
| Bot | 1 /profile, 18 /privacy (info and link until Discord linking exists), 29 outage alerts (free), 56 deep links, 11 /status (already existed, now with a deep link) |
| Web | 61 money chart, 111 public profile, 132 billing, 133 pricing, 136 privacy centre, 140 shared chart, 142 log scale, plus privacy notice, cookies and terms pages |
| Backend | 175–178 rollups and tier retention, 212–214 entitlements, middleware and grace, 220 audit log, 221 GDPR tooling, 224 idempotency, 225 circuit breaker, 239 encrypted off-site backups; 168 replaced by "no polling" |

### Phase 2: accounts and Discord (done on `feat/phase2-discord` branches)

Discord OAuth with the `identify` scope only, and linking (130, 210, 211), so the bot knows who is calling. Then /me (17), /link (16), /privacy toggles in Discord (18), /subscribe (19), tier roles (20), linked roles (21), /whois only for public profiles (12), sessions and devices page (137), multiple Minecraft accounts (131).

Phase 2 decisions: Discord login is an extra sign-in method, not a new account type. A second Minecraft account on one Discord user needs Pro or Max (idea 131). `/whois` and the roles are opt-in (`discordPublic`, `showTierRole`, both default off). The bot's key is refused on anything that came through Cloudflare. Data export and account deletion stay web-only.

### Phase 3: alerts (Pro and above) (done on `feat/phase3-alerts` branches)

Alert rules table and delivery worker, quiet hours (32), notification settings (138). Then price alerts (22, 99), anomaly alerts (23, 88, 184), co-op pings only for members with `allowActivityPings` (25, 79), daily digest (26), weekly recap (27), goal reached (28, 67), mayor reminder (31, 163). Patch alerts (30, 167) stay free. Manipulation warnings (24, 185) describe market patterns and never name players.

Phase 3 decisions: every notification is opt-in, and DMs also need Discord linked. Quiet hours delay delivery rather than drop it. Notifications are kept 90 days. Price alerts are limited to 25 on Pro and 200 on Max. Manipulation warnings describe order and volume patterns only. Goals are free; the "goal reached" alert is Pro and above. Election reminders fire when voting opens, because Hypixel's election data has no end time.

### Phase 4: bazaar and methods (done on `feat/phase4-bazaar-methods` branches)

Bazaar pages (83–98, 100), auction ingestion and lowest-BIN (159, 160), items metadata and recipes (164, 165), coins/hour engine and module registry (187, 188), method pages and builder (101–110, 189). Bot: /bz (4), /bz-history (5), /flip (6), /craft (7), /mmm (8), /mayor (14), /events (15), live bazaar channel (34).

Phase 4 decisions:
- Raw bazaar price history is free at every range, which changes idea 84. Only computed insight is paid: depth, spread, seasonality, flips, craft, anomalies and method history on Pro, correlations and custom methods on Max. This keeps paywalled content "transformative" under Hypixel's monetisation rules.
- Curated methods ship empty (`server/src/modules/market/methods/curated.ts` has a template). Only add rates the team has measured, with a source. Generated methods (order flips, NPC sells, crafts) are valued from live prices.
- Method ratings are votes only: no comments, so no Online Safety Act user-to-user duties.
- Recipes are off until `RECIPES_SOURCE_URL` is set. Check the NotEnoughUpdates-REPO licence before turning it on.
- Forecasts (186) are not built. They would need clear "experimental" labelling and evaluation first, so they move to a later phase.

### Phase 5: mod-powered insight

Mod event stream (157), inventory value (158), transfer and reset detection (161, 162), sessions from mod heartbeats (193, 13, 63), activity classifier as an opt-in (156), personal method performance (105). Co-op pages (76–82) with shared-bank ledger (78) only from members who use the mod.

### Phase 6: social and community (all opt-in)

Leaderboards from `showOnLeaderboards` (10, 35, 81, 115, 190), follow only public profiles (114), achievements and badges (44, 116, 195), Wrapped (43, 113, 194), grinding competitions from mod data (37), guild tracking limited to the guild owner's own app (36), /guess-price and /predict with no prizes (42, 45), /rich-or-not only with public profiles (46), community ratings as votes only (109).

### Phase 7: platform and ops

Public API keys and webhooks (139, 197–209), SSE live updates (144, 200), observability (230–236), staging, previews, blue-green and rollback (240–243), Renovate, SOPS and WAF (244–246), MCP ops tools, admin panel and feature flags (247–249, 155), weekly ops report (250), frontend engineering (147–154), bot context menu and ops (47, 57–60), server setup and scheduled posts (33, 38, 39).

### Changed or dropped for legal reasons

| Idea | Change |
|---|---|
| 72 retention countdown as an upgrade prompt | Dropped: a nudge aimed at a young audience. The chart states the plan's window neutrally instead. |
| 134 free trial, 216 yearly plans | Wait for DMCC renewal reminders (January 2027). |
| 13 /session, 63 session timeline | From mod heartbeats only; Hypixel bans session tracking from the API. |
| 36 guild tracking | Hypixel only allows this for the guild owner, at about one request per player per hour, or from mod data. |
| 168 adaptive polling | Replaced: player data is not polled at all. |
| 46 /rich-or-not | Only players with public profiles. |
