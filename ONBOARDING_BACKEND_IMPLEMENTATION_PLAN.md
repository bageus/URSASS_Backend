# URSASS TUBE — Onboarding Backend Implementation Plan (v2)

## Goal

Implement a persistent onboarding system for:
- Web guest players
- Web authenticated players
- Telegram authenticated players

The onboarding system must:
- survive page reloads;
- survive app reopen;
- work across devices;
- support persistent rewards and onboarding gifts;
- support spotlight/tutorial flows on frontend;
- support future onboarding extensions.

---

## 0) Architecture Audit (Preparation)

1. Validate existing identity resolution for:
   - wallet-auth players,
   - telegram-auth players,
   - guests.
2. Define a single stable `primaryId` strategy used by onboarding endpoints and services.
3. Identify current reward settlement points for run completion and store purchase hooks.

---

## 1) New Mongo Model

Create:

`models/OnboardingState.js`

Schema shape:

```js
{
  primaryId: String,

  flowVersion: "v2",

  mainFlowCompleted: false,
  mainFlowSkipped: false,

  currentStep: "auth_start",

  authRunsCount: 0,

  rewards: {
    silverAfterSecondRunGranted: false,
    goldAfterThirdRunGranted: false
  },

  storeIntro: {
    shown: false,
    skipped: false,
    ridePackBought: false
  },

  gifts: {
    radarObstacles: {
      unlocked: false,
      claimed: false,
      skipped: false,
      activeUntil: null
    },

    radarGold: {
      unlocked: false,
      claimed: false,
      skipped: false,
      activeUntil: null
    }
  },

  createdAt,
  updatedAt
}
```

Implementation notes:
- add unique index for `primaryId`;
- use timestamps;
- include `getOrCreate` helper in service layer;
- keep schema forward-compatible for future onboarding versions.

---

## 2) New API Endpoints

Add routes:

- `GET  /api/onboarding/state`
- `POST /api/onboarding/event`
- `POST /api/onboarding/claim`

Versioned aliases:

- `/api/v1/onboarding/state`
- `/api/v1/onboarding/event`
- `/api/v1/onboarding/claim`

---

## 3) GET `/api/onboarding/state`

Purpose: return canonical onboarding state for frontend UI.

Expected response includes:
- `currentStep`
- `mainFlowCompleted`
- `authRunsCount`
- `rewards`
- `storeIntro`
- `gifts`
- computed `activeBoosts` derived from temporary boosts and expiration checks.

Response example:

```json
{
  "currentStep": "auth_run_2_done",
  "mainFlowCompleted": false,

  "authRunsCount": 2,

  "rewards": {
    "silverAfterSecondRunGranted": true,
    "goldAfterThirdRunGranted": false
  },

  "storeIntro": {
    "shown": true,
    "ridePackBought": false
  },

  "gifts": {
    "radarObstacles": {
      "unlocked": true,
      "claimed": false
    },
    "radarGold": {
      "unlocked": false,
      "claimed": false
    }
  },

  "activeBoosts": {
    "radarObstaclesUntil": null,
    "radarGoldUntil": null
  }
}
```

---

## 4) POST `/api/onboarding/event`

Purpose: universal onboarding event ingestion endpoint.

Request example:

```json
{
  "event": "wallet_connected",
  "meta": {}
}
```

Supported events:

- `wallet_connected`
- `run_finished`
- `x_connected`
- `share_confirmed`
- `store_opened`
- `ride_pack_bought`
- `store_back_clicked`
- `skip_step`

Implementation requirements:
- strict event whitelist validation;
- idempotent state transitions where possible;
- internal server-side step progression only.

---

## 5) POST `/api/onboarding/claim`

Purpose: claim persistent onboarding gifts.

Request example:

```json
{
  "reward": "radar_obstacles_24h"
}
```

Supported rewards:

- `radar_obstacles_24h`
- `radar_gold_24h`

Requirements:
- idempotent;
- cannot claim twice;
- persists forever until claimed;
- survives reloads/reconnects/reopen.

---

## 6) Authenticated Run Tracking

Increment `authRunsCount` only for:
- authenticated wallet players;
- authenticated Telegram players.

Guest runs must not affect onboarding progression.

---

## 7) Onboarding Reward Logic

### First authenticated run

No bonus awarded.

Frontend hook text:
- `Run again. Get +100 silver`

### Second authenticated run

After completion:
- award `+100 silver`;
- include in run settlement payload;
- set `rewards.silverAfterSecondRunGranted = true`.

Settlement payload shape:

```json
{
  "collectedSilver": 37,
  "onboardingSilverBonus": 100,
  "totalSilverAwarded": 137
}
```

### Third authenticated run

After completion:
- award `+100 gold`;
- include in run settlement payload;
- set `rewards.goldAfterThirdRunGranted = true`.

Settlement payload shape:

```json
{
  "collectedGold": 4,
  "onboardingGoldBonus": 100,
  "totalGoldAwarded": 104
}
```

---

## 8) Store Intro Flow

- Reuse existing store product: **3 rides pack**.
- Do not create any new store product.
- Integrate with existing `POST /api/store/buy` flow.

On successful target pack purchase:
- set `storeIntro.ridePackBought = true`;
- set `mainFlowCompleted = true`.

---

## 9) Radar Gift Unlocks

### After 6 authenticated runs

Unlock:

```js
gifts.radarObstacles.unlocked = true
```

### After 15 authenticated runs

Unlock:

```js
gifts.radarGold.unlocked = true
```

Rules:
- unlocked gifts remain claimable forever until claimed.

---

## 10) Temporary Radar Boosts Model Update

Modify:

`models/PlayerUpgrades.js`

Add:

```js
temporaryBoosts: {
  radarObstaclesUntil: Date,
  radarGoldUntil: Date
}
```

Do not modify permanent upgrades behavior.

---

## 11) Radar Claim Logic

When claiming `radar_obstacles_24h`:

```js
temporaryBoosts.radarObstaclesUntil = now + 24 hours
```

When claiming `radar_gold_24h`:

```js
temporaryBoosts.radarGoldUntil = now + 24 hours
```

And mark onboarding gift as claimed.

---

## 12) Runtime Effect Calculation

Update effect builder rules:

Radar is active if:
- permanent upgrade exists, **OR**
- temporary boost exists and is not expired.

Apply to:
- `radar_obstacles`
- `radar_gold`

---

## 13) Persistence Rules

Server-side onboarding state is source of truth.

Must persist across:
- reload;
- reconnect;
- Telegram reopen;
- wallet reconnect.

Frontend `localStorage` must never be source of truth for:
- rewards;
- onboarding completion;
- gifts;
- active boosts.

---

## 14) Edge Cases

1. Reload after 3rd authenticated run:
   - onboarding continues from store intro stage.
2. Reload after rides pack purchase:
   - onboarding already completed.
3. Gift skipped:
   - remains claimable forever until claimed.
4. Manual store entry:
   - if gift unlocked, onboarding gift flow continues automatically.

---

## 15) Analytics Events

Track:
- `onboarding_step_shown`
- `onboarding_step_skipped`
- `onboarding_completed`
- `onboarding_reward_granted`
- `onboarding_reward_claimed`
- `radar_gift_unlocked`
- `radar_gift_claimed`

Recommended payload:
- `primaryId`
- `flowVersion`
- `currentStep`
- `event/reward`
- `authRunsCount`
- `timestamp`

---

## 16) Implementation Order

1. Add `OnboardingState` model.
2. Add onboarding service (state transitions + run/gift rules).
3. Add onboarding routes + v1 aliases.
4. Integrate run-finish settlement bonuses.
5. Integrate store-buy completion hook.
6. Add temporary boosts to `PlayerUpgrades`.
7. Update runtime effect builder.
8. Add analytics events.
9. Add tests (unit + integration + edge cases).
10. Deploy and run smoke checks for Web + Telegram auth paths.

---

## 17) Acceptance Checklist

- [x] Onboarding state persists in Mongo and restores after reload/reopen.
- [x] Guests do not progress authenticated onboarding runs.
- [x] 2nd authenticated run grants +100 silver exactly once.
- [x] 3rd authenticated run grants +100 gold exactly once.
- [x] Store intro finalizes on existing 3 rides pack purchase.
- [x] Gifts unlock at run 6 and run 15 thresholds.
- [x] Gift claims are idempotent and non-repeatable.
- [x] Temporary radar boosts activate for 24h.
- [x] Runtime effects respect permanent OR temporary boost logic.
- [x] Analytics events emitted for key onboarding milestones.
