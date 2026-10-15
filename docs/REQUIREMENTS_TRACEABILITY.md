# EKI requirements traceability

Source: `EKI_Requirements_Gathering_Brief.pdf`, a blank questionnaire containing eight sections and 65 questions. Blank questions are intentionally not answered here. Status meanings: PASS = locally implemented and tested; PARTIAL = some local implementation/evidence but a gap remains; BLOCKED = client/account/external contract or unavailable infrastructure prevents verification; FAIL = an identified local requirement is not met.

| Q | Requirement from brief | Status | Existing implementation / exact location | Missing or evidence | Client / external dependency |
|---:|---|---|---|---|---|
| 1 | Legal/business name | BLOCKED | `api/src/modules/settings/schema.ts` brandLegalName | Blank setting; no answer | Client answer |
| 2 | Website | BLOCKED | settings schema brandWebsite | Blank setting | Client answer |
| 3 | Logo | BLOCKED | Media storage exists in `api/src/lib/storage.ts` | No approved logo supplied | Client asset/access |
| 4 | Brand colors | BLOCKED | brandPrimary/Secondary/Accent settings | Blank values | Client answer |
| 5 | Fonts | BLOCKED | brandFonts setting | Blank value; renderer defaults to Arial | Client answer/asset |
| 6 | Brand voice | BLOCKED | brandVoice setting, consumed only when configured | Blank answer | Client answer |
| 7 | Countries | BLOCKED | operatingCountries setting | Blank answer | Client answer |
| 8 | Diaspora communities | BLOCKED | targetDiasporaCommunities setting | Blank answer | Client answer |
| 9 | Most important customer fact | BLOCKED | Audience/settings fields exist | Blank answer | Client answer |
| 10 | Marketplace exists | PARTIAL | `api/src/routes/campaigns.ts`; marketplaceTruth setting | Marketplace activation API not verified | Client confirmation/API |
| 11 | Current stack | PASS | Native API/worker/Postgres/Redis/BullMQ in `docs/ARCHITECTURE.md` | n8n remains legacy/optional | Architectural decision |
| 12 | Marketplace API docs | BLOCKED | No native marketplace client | Contract absent | EKI API docs/credentials |
| 13 | Vendor signup process | BLOCKED | No vendor onboarding model | Process unknown | Client answer/contract |
| 14 | Free vendor store/cost | BLOCKED | No pricing truth supplied | Unknown | Client answer |
| 15 | Revenue model | BLOCKED | No revenue model field | Unknown | Client answer |
| 16 | Shipping | BLOCKED | No shipping rules | Unknown | Client answer |
| 17 | Currencies | BLOCKED | No currency configuration | Unknown | Client answer |
| 18 | Payment methods | BLOCKED | No payment contract | Unknown | Client answer/provider |
| 19 | Buyer protection/disputes | BLOCKED | No policy integration | Unknown | Client policy/answer |
| 20 | Ideal vendor profile | BLOCKED | vendorAudienceProfile setting | Blank answer | Client answer |
| 21 | Ideal buyer profile | BLOCKED | buyerAudienceProfile setting | Blank answer | Client answer |
| 22 | Vendor frustrations | BLOCKED | vendorPainPoints setting | Blank answer | Client answer |
| 23 | Buyer fears | BLOCKED | buyerFears setting | Blank answer | Client answer |
| 24 | Product categories | BLOCKED | productCategories setting | Blank answer | Client answer |
| 25 | Languages | BLOCKED | audienceLanguages setting | Blank answer | Client answer |
| 26 | Vendor FAQ | BLOCKED | No approved FAQ source | Unknown | Client content |
| 27 | Buyer FAQ | BLOCKED | No approved FAQ source | Unknown | Client content |
| 28 | Social accounts | BLOCKED | Provider integrations exist | Real handles/tokens not connected | Client account access |
| 29 | WhatsApp number | BLOCKED | WhatsApp integration definitions | Number/account unknown | Client account access |
| 30 | Existing content | BLOCKED | Media upload/storage exists | No content corpus supplied | Client assets |
| 31 | Testimonials | BLOCKED | No approved testimonial store | Unknown/unsafe to invent | Client-approved content |
| 32 | Customer/lead data | PARTIAL | n8n lead flows and audit infrastructure exist | Native lead/consent data contract absent | Client data export/permissions |
| 33 | Competitors | BLOCKED | No competitor setting | Blank answer | Client answer |
| 34 | Branded hashtags | BLOCKED | brandedHashtags setting | Blank answer | Client answer |
| 35 | Tone | BLOCKED | brandVoice/content tone settings | Blank answer | Client answer |
| 36 | Priority formats | PARTIAL | Video and carousel pipelines; contentFormats setting | Client priorities blank; Stories/FB completeness unverified | Client answer |
| 37 | Posts/day | BLOCKED | postsPerDay setting | Blank answer | Client answer |
| 38 | Forbidden topics | PASS | contentForbiddenTopics; video/carousel pre/post checks | Requires populated approved list | Client answer |
| 39 | Inspiration accounts | BLOCKED | inspirationAccounts setting | Blank answer | Client answer |
| 40 | Pidgin policy | BLOCKED | pidginPolicy defaults to unspecified | Client choice required | Client answer |
| 41 | Calendar/seasonal events | BLOCKED | No approved calendar | Unknown | Client calendar |
| 42 | Real vendor media | BLOCKED | Media storage supports upload | No vendor media supplied | Client assets/consent |
| 43 | Human approver | PARTIAL | Telegram/UI approval routes and approval fingerprints | Real approver/account not configured | Client permission/account |
| 44 | Complex DM responder | PARTIAL | n8n/ManyChat compatibility workflows | Native policy/answer contract not verified | Client decision/provider |
| 45 | Timezone | PARTIAL | Schedule stores UTC/IANA timezone | Client timezone blank | Client answer |
| 46 | Budget | BLOCKED | Usage ledger/pricing/settings exist | Budget unknown | Client answer |
| 47 | Go-live date | BLOCKED | Deployment docs exist | Date unknown | Client answer |
| 48 | n8n preference | PARTIAL | n8n remains optional legacy/supervisor path | Explicit architecture decision required | Client/architecture decision |
| 49 | Existing tools | PARTIAL | n8n, ManyChat, Buffer, Apify, WATI documented | Current ownership/usage unverified | Client answer/access |
| 50 | Weekly strategy reviewer | BLOCKED | No reviewer assignment | Unknown | Client answer |
| 51 | Social proof curator | BLOCKED | No curator assignment | Unknown | Client answer |
| 52 | Team access | BLOCKED | Admin auth exists | Team members/roles unknown | Client permissions |
| 53 | Month 1 metrics | BLOCKED | Dashboard/usage metrics exist | Targets blank | Client answer |
| 54 | CPL | BLOCKED | No verified lead attribution cost baseline | Target/source unknown | Client answer/data |
| 55 | Priority metric | BLOCKED | Dashboard aggregates operational metrics | Priority blank | Client answer |
| 56 | ROI measurement | PARTIAL | Campaign model and usage cost aggregation | Revenue/activation event contract absent | Client data/API |
| 57 | Baseline engagement | BLOCKED | No baseline data | Unknown | Client analytics export |
| 58 | Active vendors in six months | BLOCKED | No activation integration | Target and event contract unknown | Client answer/API |
| 59 | Monthly buyers in six months | BLOCKED | No buyer metric source | Target and data source unknown | Client answer/API |
| 60 | Privacy policy | BLOCKED | Helmet/auth controls exist | Policy text/URL absent | Client legal content |
| 61 | WhatsApp opt-in consent | PARTIAL | n8n opt-out evidence and approved-template setting exist | Native consent persistence and real account evidence missing | Client policy/WhatsApp account |
| 62 | NDA | BLOCKED | No NDA record | Unknown | Client/legal |
| 63 | Terms of Service | BLOCKED | No terms source | Unknown | Client legal content |
| 64 | Regulated products | BLOCKED | Forbidden-topic controls exist | Regulated-category answer absent | Client legal answer |
| 65 | Publication restrictions | BLOCKED | Approval/emergency stop enforce local controls | Account/platform restrictions unknown | Client answer/account contracts |

## Architecture reconciliation

The brief’s proposed n8n/Airtable/ManyChat/Buffer/Apify/WATI stack is not the current runtime. The production-native path is TypeScript API + PostgreSQL + Redis/BullMQ + TypeScript worker, with shared usage/cost and safety behavior. n8n remains an optional compatibility/legacy orchestration path for existing workflows; Airtable is not a required data store, and ManyChat/Buffer/Apify/WATI are optional external adapters until EKI confirms ownership and contracts. Reintroducing n8n as a mandatory runtime would be an explicit architecture decision, not an implicit requirement from the blank questionnaire.

## Launch blockers

1. Supply answers for all blank business, audience, content, approval, metrics, legal, timezone, budget and go-live questions.
2. Supply real social publishing accounts/tokens and confirm permitted targets; no real publication or WhatsApp send has been performed by tests.
3. Supply the EKI marketplace vendor-signup/activation API or webhook contract and staging credentials.
4. Supply WhatsApp Business/WATI/ManyChat ownership, opt-in records, approved templates and compliance approval.
5. Supply deploy credentials/infrastructure access, a database backup/restore window, and staging access for the emergency-stop and migration exercises.
6. Complete external security testing and resolve or accept the remaining dependency findings.
