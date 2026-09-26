# Event entity — short canon (V1)

**Date:** 2026-09-26  
**Status:** Working canon for branch `feature/events-admin`  
**Companion plan:** [`../plans/EVENTS_FULL_WORK_PLAN_V1.md`](../plans/EVENTS_FULL_WORK_PLAN_V1.md)  
**Live map:** [`../architecture/runtime/PLATFORM_LIFECYCLE_V1.md`](../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Event  

This is a short product law for events. It does not replace Lifecycle for pipeline details.

---

## What it is

A dated community affiche: meetup, concert, fair, class, stream, holiday gathering.

Not a business card. Not a job listing.

---

## Product decisions (Stage 0 — locked for this branch)

| Question | Decision |
|---|---|
| Hub rank | **Complement** to Business / Professional / Marketplace / Jobs — important, not MVP-equal |
| User publish path | **A** — user publish goes live immediately; admin can archive/edit |
| Ownership | Creator (`owner_profile_id`) owns user-created events. Import may set approving admin as owner until claim UX matures; imported ≠ community trust by itself |

---

## Statuses

| Status | Meaning |
|---|---|
| `draft` | Not on public site |
| `published` | Visible on `/events` |
| `archived` | Hidden from public feed |

---

## Publish minimum

1. Title (≥3 chars)  
2. Date **or** explicit «Дата уточняется»  
3. For offline/hybrid — address  
4. Description without phones/addresses buried as the only contact path (contacts in fields)

Import approve additionally: no silent empty date — need structured date, `[event_date_confirmed]`, or «Дата уточняется».

---

## Where to work

| Job | Place |
|---|---|
| Public list / calendar | `/events` (default: upcoming) |
| Create | `/events/new` |
| Owner manage | `/events/mine`, `/events/[slug]/edit` |
| Admin edit / archive | `/admin/catalog/events`, `/admin/catalog/events/[id]/edit` |
| Queue from chats | `/admin/review/inbox?view=events` |
| Legacy `/admin/events` | Redirects to Inbox |

---

## Good-event rules (for authors)

1. Clear title (what + who it’s for).  
2. Real date/time, or say date is TBD.  
3. Place or «online».  
4. Phone / Telegram / registration link in their fields.  
5. Description tells what happens — not a wall of contacts.  
6. No spam, no fake free giveaways.  
7. After the event — archive or leave past filter to hide it from «upcoming».

---

## Out of scope for now

Tickets/payments product, recurring series, Facebook/CSV import history UI, treating Events as freeze-MVP peer of Business.
