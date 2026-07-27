# Recommendations

## Purpose

Mine comment/chat recommendations into a queue; approve into professionals/businesses/events.

## Source of Truth

- Live: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) § Recommendations

## Primary documents

- Admin index: [`../admin/INDEX.md`](../admin/INDEX.md)

## Primary code location

- Admin UI: [`../../../app/admin/recommendations/page.tsx`](../../../app/admin/recommendations/page.tsx)
- Components: [`../../../components/admin/CommentRecommendationsPanel.tsx`](../../../components/admin/CommentRecommendationsPanel.tsx)
- Lib: [`../../../lib/import-review/recommendation-*.ts`](../../../lib/import-review/)
- Extractors: [`../../../scripts/telegram-collector/extract_telegram_recommendations.py`](../../../scripts/telegram-collector/extract_telegram_recommendations.py), [`../../../scripts/facebook-collector/extract_comment_recommendations.py`](../../../scripts/facebook-collector/extract_comment_recommendations.py)
- Publish catalog: [`../../../scripts/business-enrich/publish_recommendation_catalog.py`](../../../scripts/business-enrich/publish_recommendation_catalog.py)

## Main database objects

- `import_comment_recommendations`

## Entry points

- `/admin/recommendations`
- CLI extract + publish scripts

## Main RPC

- See migrations / recommendation actions; no separate catalog doc found

## Main API

- Server Actions: `lib/import-review/recommendation-actions.ts`

## Related documents

- [`PUBLISH.md`](./PUBLISH.md), [`../ai/INDEX.md`](../ai/INDEX.md)

## Deprecated paths

- Unknown
