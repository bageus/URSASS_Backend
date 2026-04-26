# Leaderboard API v2 (backward-compatible extension)

## Feature flag

Insights are controlled by `LEADERBOARD_INSIGHTS_ENABLED` (default: enabled unless explicitly `false`).

## GET `/api/leaderboard/top`

### Backward compatibility

Existing fields are preserved:

- `leaderboard`
- `playerPosition`

### Optional v2 fields

Enable with query parameter:

- `?v=2&wallet=0x...`
- or `?includeInsights=true&wallet=0x...`

Response adds:

- `playerInsights` (optional)

### `playerInsights` schema

```json
{
  "isFirstRun": true,
  "isPersonalBest": true,
  "enteredTop10": false,
  "rank": 42,
  "totalRankedPlayers": 125000,
  "percentileOverall": 99.97,
  "percentileFirstRunScore": 91.5,
  "percentileFirstRunDistance": 89.2,
  "percentileFirstRunCoins": 75.0,
  "comparisonMode": "first_run_score",
  "comparisonTextFallbackType": "normal",
  "nextTargets": [
    {
      "targetType": "rank",
      "targetRank": 10,
      "scoreToReach": 8450,
      "delta": 120,
      "priority": 1
    }
  ],
  "recommendedTarget": {
    "targetType": "rank",
    "type": "rank",
    "label": "TOP 10",
    "delta": 120
  }
}
```

## GET `/api/leaderboard/insights?wallet=0x...`

Returns personalized insights without leaderboard list.

```json
{
  "wallet": "0x...",
  "playerInsights": { "...": "same schema as above" }
}
```

## Comparison/fallback behavior

- Backend tries meaningful percentile from first-run cohorts (`score`, `distance`, `coins`).
- If segment sample size is below `LEADERBOARD_INSIGHTS_MIN_SEGMENT_SIZE`, mode becomes `none`.
- If percentile is weak (`< LEADERBOARD_INSIGHTS_WEAK_PERCENTILE`):
  - first run => `weak_first_run`
  - repeat run => `weak_repeat_run`

## Realistic target selection

Thresholds are configurable by env:

- `LEADERBOARD_INSIGHTS_MAX_DELTA_TOP10`
- `LEADERBOARD_INSIGHTS_MAX_DELTA_TOP100`
- `LEADERBOARD_INSIGHTS_MAX_DELTA_TOP1000`
- `LEADERBOARD_INSIGHTS_MAX_DELTA_TOP10000`

Target logic:

- Top-10 players get higher-rank realistic jumps.
- Top-100 players prioritize Top-10 but may receive intermediate rank target.
- Top-1000 players prioritize Top-100.
- Top-10000 players prioritize Top-1000.
- Outside Top-10000 players prioritize entering Top-10000.

## Personal best priority

When the current run score is below the player's personal best score, `recommendedTarget` is a score-based personal best goal instead of a rank-based goal:

```json
{
  "targetType": "score",
  "type": "score",
  "label": "your best",
  "delta": 15492
}
```

`delta` = `bestScore - currentScore + 1`.

Rank-based targets remain in `nextTargets` and are still available to the frontend.

The `type` field mirrors `targetType` and is provided for forward compatibility with frontends that validate `type/label/delta`.
