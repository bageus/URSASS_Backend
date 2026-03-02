<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Bear Tube Runner</title>
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://telegram.org; connect-src 'self' https: data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<link rel="icon" type="image/png" href="img/favicon.png">
<script src="https://cdn.jsdelivr.net/npm/@metamask/detect-provider/dist/detect-provider.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/ethers@5/dist/ethers.umd.min.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js" defer></script>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;800&display=swap" rel="stylesheet">

<style>
/* =========================
   TOKENS / BASE
========================= */
:root {
  --bg: #05030b;
  --text: #fff;
  --glass: rgba(255, 255, 255, .06);
  --glass2: rgba(255, 255, 255, .04);
  --border: rgba(255, 255, 255, .10);
  --border-accent: rgba(140, 80, 255, .40);
  --grad: linear-gradient(90deg, #c084ff, #60a5fa, #22d3ee);
  --shadowTitle1: 0 0 20px rgba(140, 80, 255, .6);
  --shadowTitle2: 0 0 50px rgba(60, 150, 255, .4);
  --radius-pill: 20px;
  --radius: 12px;
  --z-bg: 0;
  --z-vignette: 1;
  --z-hero: 5;
  --z-topbar: 40;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

body {
  font-family: 'Orbitron', sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
}

/* =========================
   GLOBAL AUDIO TOGGLES (левый угол, все страницы)
========================= */
#audioTogglesGlobal {
  position: fixed;
  top: 10px;
  left: 12px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: var(--glass);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: border-color .3s, box-shadow .3s, transform .15s;
}

.toggle-row:active {
  transform: scale(0.97);
}

.toggle-row.active {
  border-color: rgba(140, 80, 255, .35);
  box-shadow: 0 0 10px rgba(140, 80, 255, .15);
}

.toggle-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  opacity: .9;
  min-width: 62px;
  pointer-events: none;
}

/* Toggle switch */
.switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, .08);
  border-radius: 22px;
  transition: background .35s ease, box-shadow .35s ease;
}

.slider:before {
  content: "";
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background: rgba(255, 255, 255, .35);
  border-radius: 50%;
  transition: transform .35s cubic-bezier(.4, .0, .2, 1), background .35s ease, box-shadow .35s ease;
}

input:checked + .slider {
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  box-shadow: 0 0 12px rgba(139, 92, 246, .4);
}

input:checked + .slider:before {
  transform: translateX(18px);
  background: linear-gradient(135deg, #c084fc, #e879f9);
  box-shadow: 0 0 6px rgba(192, 132, 252, .5);
}

/* =========================
   WALLET CORNER (правый угол)
========================= */
#walletCorner {
  position: fixed;
  top: 10px;
  right: 30px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.wallet-btn-corner {
  padding: 8px 16px;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: var(--glass);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: .3s;
  white-space: nowrap;
}

.wallet-btn-corner:active {
  transform: scale(0.96);
}

.wallet-btn-corner:hover {
  box-shadow: 0 0 15px rgba(140, 80, 255, .25);
  transform: translateY(-1px);
}

.wallet-btn-corner.connected {
  border-color: rgba(140, 80, 255, .45);
}

.wallet-btn-corner.connected:hover {
  border-color: rgba(255, 100, 100, .4);
  box-shadow: 0 0 12px rgba(255, 100, 100, .15);
}

.wallet-info {
  display: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  padding: 10px 14px;
  background: var(--glass);
  backdrop-filter: blur(12px);
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.wallet-info.visible {
  display: flex;
}

.wallet-info-row {
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, .85);
  display: flex;
  align-items: center;
  gap: 6px;
}

.wallet-info-row img {
  width: 18px;
  height: 18px;
  vertical-align: middle;
}

.wallet-info-row .val {
  color: #c084fc;
}

.wallet-info-row .val-gold {
  color: #fbbf24;
}

.wallet-info-row .val-silver {
  color: #94a3b8;
}

/* =========================
   BACKGROUND
========================= */
.stars,
.stars2 {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: var(--z-bg);
}

.stars {
  height: 200%;
  background:
    radial-gradient(2px 2px at 20% 30%, white, transparent),
    radial-gradient(1px 1px at 70% 60%, white, transparent),
    radial-gradient(2px 2px at 40% 80%, white, transparent),
    radial-gradient(1px 1px at 90% 20%, white, transparent),
    radial-gradient(1px 1px at 10% 50%, rgba(255, 255, 255, .8), transparent),
    radial-gradient(2px 2px at 60% 10%, rgba(255, 255, 255, .8), transparent),
    radial-gradient(1px 1px at 80% 90%, white, transparent),
    radial-gradient(1.5px 1.5px at 15% 70%, white, transparent),
    radial-gradient(1px 1px at 55% 45%, white, transparent),
    radial-gradient(2px 2px at 85% 55%, rgba(255, 255, 255, .7), transparent),
    radial-gradient(1px 1px at 35% 15%, white, transparent),
    radial-gradient(1.5px 1.5px at 75% 85%, rgba(255, 255, 255, .9), transparent),
    radial-gradient(1px 1px at 45% 35%, white, transparent),
    radial-gradient(2px 2px at 25% 90%, white, transparent),
    radial-gradient(1px 1px at 65% 25%, rgba(255, 255, 255, .6), transparent);
  opacity: .6;
  animation: starMove 120s linear infinite;
}

.stars2 {
  height: 100%;
  background:
    radial-gradient(1px 1px at 12% 22%, rgba(255, 255, 255, .9), transparent),
    radial-gradient(1px 1px at 32% 68%, rgba(255, 255, 255, .7), transparent),
    radial-gradient(1.5px 1.5px at 52% 12%, rgba(200, 180, 255, .8), transparent),
    radial-gradient(1px 1px at 72% 42%, rgba(255, 255, 255, .6), transparent),
    radial-gradient(1px 1px at 88% 78%, rgba(200, 200, 255, .8), transparent),
    radial-gradient(1.5px 1.5px at 8% 88%, rgba(255, 220, 255, .7), transparent),
    radial-gradient(1px 1px at 48% 58%, rgba(255, 255, 255, .5), transparent),
    radial-gradient(1px 1px at 68% 8%, rgba(180, 200, 255, .8), transparent),
    radial-gradient(1px 1px at 28% 48%, rgba(255, 255, 255, .6), transparent),
    radial-gradient(1.5px 1.5px at 92% 32%, rgba(220, 200, 255, .7), transparent);
  animation: twinkle 3s ease-in-out infinite alternate;
}

.vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle, transparent 40%, rgba(0, 0, 0, .6) 100%);
  z-index: var(--z-vignette);
}

/* =========================
   HERO / BEAR
========================= */
.bear-wrapper {
  position: relative;
  width: 150vw;
  max-width: 1000px;
  height: 150vw;
  max-height: 1000px;
  animation: fadeIn 1.5s ease forwards;
  opacity: 0;
  margin-top: -150px;
  margin-bottom: -250px;
  -webkit-mask-image: linear-gradient(to bottom, white 30%, transparent 80%);
  mask-image: linear-gradient(to bottom, white 30%, transparent 80%);
}

.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.glow {
  filter: blur(70px);
  opacity: .6;
  mix-blend-mode: screen;
  animation: pulseGlow 4s ease-in-out infinite;
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at center 40%, white 20%, transparent 70%);
  mask-image: radial-gradient(ellipse 60% 50% at center 40%, white 20%, transparent 70%);
}

.eyes {
  mix-blend-mode: screen;
  animation: eyeFlicker 4s ease-in-out infinite alternate;
}

.particle {
  position: absolute;
  width: 4px;
  height: 4px;
  background: orange;
  border-radius: 50%;
  opacity: .7;
  animation: float 6s linear infinite;
}

/* =========================
   TITLE / BUTTONS
========================= */
.new-title {
  font-size: 50px;
  margin-top: -30px;
  position: relative;
  z-index: 10;
  background: var(--grad);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: fadeUp 1.5s ease forwards;
  opacity: 0;
  text-align: center;
}

.new-buttons {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 420px;
  padding: 0 20px;
}

.btn-new {
  width: 100%;
  padding: 16px 40px;
  background: var(--glass2);
  backdrop-filter: blur(15px);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius);
  cursor: pointer;
  transition: .4s;
  color: var(--text);
  font-family: 'Orbitron', sans-serif;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
  position: relative;
  overflow: hidden;
  text-align: center;
}

.btn-new:hover {
  box-shadow: 0 0 30px rgba(139, 92, 246, .4);
  transform: translateY(-3px);
  border-color: rgba(140, 80, 255, .7);
}

.btn-new:active {
  transform: scale(0.95);
}

.btn-new-primary {
  border-color: rgba(99, 102, 241, .6);
}

.btn-new-primary::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10%;
  right: 10%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #818cf8, #c084fc, #818cf8, transparent);
  border-radius: 2px;
  box-shadow: 0 0 15px rgba(129, 140, 248, .6);
}

.btn-new-store {
  border-color: rgba(96, 165, 250, .4);
}

.btn-new-store::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 15%;
  right: 15%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #60a5fa, #22d3ee, #60a5fa, transparent);
  border-radius: 2px;
  box-shadow: 0 0 12px rgba(96, 165, 250, .5);
}

.btn-new.connected {
  border-color: rgba(140, 80, 255, .4);
  box-shadow: 0 0 12px rgba(140, 80, 255, .15);
}

/* =========================
   LEADERBOARD
========================= */
.lb {
  margin: 30px auto 0;
  width: 100%;
  max-width: 440px;
  background: rgba(255, 255, 255, .03);
  backdrop-filter: blur(15px);
  border-radius: 15px;
  padding: 20px 20px 14px;
  border: 1px solid rgba(140, 80, 255, .20);
}

.lb-title {
  text-align: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 14px;
  letter-spacing: 2px;
  background: var(--grad);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.lb-list {
  max-height: 350px;
  overflow-y: auto;
}

.lb-row {
  display: flex;
  align-items: center;
  padding: 9px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .04);
  border-radius: 8px;
  margin-bottom: 2px;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  transition: background .3s;
}

.lb-row:last-child {
  border-bottom: none;
}

.lb-row:hover {
  background: rgba(140, 80, 255, .08);
}

.lb-row.lb-row--me {
  background: rgba(140, 80, 255, .12);
  border: 1px solid rgba(140, 80, 255, .30);
}

.lb-rank {
  min-width: 32px;
  text-align: center;
  font-weight: 700;
  color: #c084fc;
  font-size: 13px;
}

.lb-rank.gold { color: #fbbf24; }
.lb-rank.silver { color: #94a3b8; }
.lb-rank.bronze { color: #cd7f32; }

.lb-wallet {
  flex: 1;
  margin-left: 10px;
  color: rgba(255, 255, 255, .65);
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}

.lb-score {
  min-width: 70px;
  text-align: right;
  font-weight: 700;
  color: #c084fc;
  font-size: 12px;
}

.lb-empty {
  text-align: center;
  padding: 25px 10px;
  opacity: 0.4;
  font-size: 12px;
  font-family: 'Orbitron', sans-serif;
}

/* Skeleton */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-row {
  display: flex;
  align-items: center;
  padding: 10px 10px;
  gap: 12px;
  margin-bottom: 4px;
}

.skeleton-block {
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, .04) 25%,
    rgba(255, 255, 255, .10) 50%,
    rgba(255, 255, 255, .04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

.skeleton-rank { width: 28px; }
.skeleton-wallet { flex: 1; }
.skeleton-score { width: 55px; }

/* =========================
   GAME START
========================= */
#gameStart {
  display: flex;
  position: fixed;
  inset: 0;
  background: transparent;
  text-align: center;
  align-items: center;
  justify-content: flex-start;
  z-index: 100;
  flex-direction: column;
  padding: 10px 20px 40px;
  overflow-y: auto;
}

#gameStart.hidden {
  display: none;
}

.start-hint {
  margin-top: 20px;
  opacity: 0.5;
  font-size: 12px;
  line-height: 1.6;
}

/* =========================
   GAME CONTAINER
========================= */
#gameContainer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

#gameContainer.active {
  display: flex;
}

#gameWrapper {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: #0a0a15;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

#gameContent {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0a0a15 0%, #15080f 100%);
  width: 100%;
  height: 100%;
}

canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
  touch-action: none;
  image-rendering: crisp-edges;
}
/* Telegram Mini App */
body {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* Telegram тёмный header */
html {
  background: #05030b;
}
/* =========================
   GAME HUD (новый стиль)
========================= */
#uiTopLeft {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  background: var(--glass);
  backdrop-filter: blur(12px);
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-family: 'Orbitron', sans-serif;
}

#uiTopLeft > div {
  margin: 4px 0;
  font-weight: 600;
  font-size: 13px;
}

#uiTopLeft .score {
  color: #c084fc;
  font-size: 15px;
}

#uiTopLeft .distance {
  color: rgba(255, 255, 255, .8);
  font-size: 15px;
}

#uiTopRight {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  background: var(--glass);
  backdrop-filter: blur(12px);
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
}

#uiTopRight > div {
  margin: 3px 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

#uiTopRight .label { opacity: 0.6; }
#uiTopRight .value { font-weight: 700; color: #c084fc; }

#uiBottomCenter {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  background: var(--glass);
  backdrop-filter: blur(12px);
  padding: 10px 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-accent);
  text-align: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
}

#uiBottomCenter .coins-row {
  display: flex;
  justify-content: space-around;
  margin: 6px 0;
  font-size: 14px;
  font-weight: 700;
}

#uiBottomCenter .coin {
  display: flex;
  align-items: center;
  gap: 5px;
}

#uiBottomCenter .coin .count { color: #c084fc; }
#uiBottomCenter .speed-info { opacity: .7; font-size: 11px; }

#fpsVal { color: #4caf50; font-weight: bold; }
#fpsVal.slow { color: #ff9800; }
#fpsVal.critical { color: #ff5252; }

/* In-game audio buttons — правый нижний угол */
.game-audio-nav {
  position: absolute;
  right: 14px;
  bottom: 70px;
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.game-audio-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text);
  background: var(--glass);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
  transition: .3s;
  padding: 0;
  line-height: 1;
}

.game-audio-btn:active {
  transform: scale(0.88);
}

.game-audio-btn.muted {
  opacity: 0.35;
  border-color: rgba(255, 255, 255, .05);
}

@media (max-width: 768px) {
  .game-audio-nav {
    right: 10px;
    bottom: 65px;
    gap: 6px;
  }
  .game-audio-btn {
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
}

@media (max-width: 480px) {
  .game-audio-nav {
    right: 8px;
    bottom: 60px;
  }
  .game-audio-btn {
    width: 30px;
    height: 30px;
    font-size: 12px;
  }
}
/* =========================
   GAME OVER
========================= */
#gameOver {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow-y: auto;
}

#gameOver.visible {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 40px 20px;
}

.go-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 3, 11, .92);
  z-index: -1;
}

.go-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 42px;
  font-weight: 800;
  background: linear-gradient(90deg, #c084ff, #60a5fa, #22d3ee);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 10px;
  animation: fadeUp 0.8s ease forwards;
  opacity: 0;
}

.go-reason {
  font-family: 'Orbitron', sans-serif;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 20px;
  padding: 10px 24px;
  background: rgba(255, 255, 255, .04);
  border: 1px solid rgba(140, 80, 255, .25);
  border-radius: var(--radius-pill);
  animation: fadeUp 0.8s ease 0.1s forwards;
  opacity: 0;
}

.go-reason-text {
  background: linear-gradient(90deg, #ff6b6b, #ff8e8e, #c084ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.go-stats {
  width: 100%;
  max-width: 400px;
  background: var(--glass);
  backdrop-filter: blur(15px);
  border-radius: 15px;
  border: 1px solid var(--border-accent);
  padding: 20px 25px;
  margin-bottom: 25px;
  animation: fadeUp 0.8s ease 0.2s forwards;
  opacity: 0;
}

.go-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
}

.go-stat-row:last-child { border-bottom: none; }
.go-stat-label { opacity: 0.7; }
.go-stat-value { font-weight: 700; color: #c084fc; }
.go-stat-value.coins-gold { color: #fbbf24; }
.go-stat-value.coins-silver { color: #94a3b8; }

.go-buttons {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 30px;
  animation: fadeUp 0.8s ease 0.3s forwards;
  opacity: 0;
}

.go-btn {
  padding: 14px 35px;
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
  border: none;
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  transition: .4s;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.go-btn:active { transform: scale(0.95); }

.go-btn-restart {
  background: rgba(255, 107, 107, .10);
  border: 1px solid rgba(255, 107, 107, .25);
}

.go-btn-restart:hover {
  box-shadow: 0 0 18px rgba(255, 107, 107, .2);
  transform: translateY(-2px);
  background: rgba(255, 107, 107, .15);
}

.go-btn-menu {
  background: var(--glass2);
  border: 1px solid var(--border);
}

.go-btn-menu:hover {
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
  border-color: var(--border-accent);
}

.go-lb-wrap {
  width: 100%;
  max-width: 440px;
  margin-left: auto;
  margin-right: auto;
  animation: fadeUp 0.8s ease 0.4s forwards;
  opacity: 0;
}

.go-lb-wrap .lb {
  margin-top: 0;
  max-width: 100%;
}

/* =========================
   STORE
========================= */
#storeScreen {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100;
  flex-direction: column;
  align-items: center;
  padding: 20px 20px 20px 70px;
  overflow-y: auto;
  background: rgba(5, 3, 11, .96);
  backdrop-filter: blur(10px);
}

#storeScreen.visible {
  display: flex;
}

.store-header {
  width: 100%;
  max-width: 440px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.store-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 24px;
  font-weight: 800;
  background: var(--grad);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.store-coins {
  display: flex;
  gap: 14px;
  align-items: center;
}

.store-coin-display {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  font-weight: 700;
  padding: 6px 12px;
  background: var(--glass);
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
}

.store-coin-display img { width: 18px; height: 18px; }
.store-coin-display .store-gold-val { color: #fbbf24; }
.store-coin-display .store-silver-val { color: #94a3b8; }

.store-back-btn {
  padding: 8px 20px;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: var(--glass2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: .3s;
  margin-top: 20px;
}

.store-back-btn:hover {
  border-color: var(--border-accent);
  box-shadow: 0 0 15px rgba(140, 80, 255, .2);
}

.store-back-btn:active { transform: scale(0.96); }

.store-list {
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 0;
}

.store-item {
  background: var(--glass);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  transition: .3s;
}

.store-item:hover {
  border-color: var(--border-accent);
  box-shadow: 0 0 12px rgba(140, 80, 255, .1);
}

.store-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.store-item-name {
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, .9);
}

.store-item-currency {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  opacity: .6;
}
/* Store — фиксированные кнопки слева */
.store-fixed-nav {
  position: fixed;
  left: 14px;
  top: 24px;
  z-index: 110;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.store-nav-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text);
  background: var(--glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--border-accent);
  border-radius: 50%;
  cursor: pointer;
  transition: .3s;
  padding: 0;
  line-height: 1;
  font-family: 'Orbitron', sans-serif;
}

.store-nav-btn:hover {
  box-shadow: 0 0 18px rgba(140, 80, 255, .3);
  transform: scale(1.08);
  border-color: rgba(140, 80, 255, .7);
}

.store-nav-btn:active {
  transform: scale(0.92);
}

.store-nav-btn.muted {
  opacity: 0.4;
  border-color: rgba(255, 255, 255, .08);
}

@media (max-width: 768px) {
  .store-fixed-nav {
    left: 8px;
    top: 16px;
    gap: 8px;
  }
  .store-nav-btn {
    width: 38px;
    height: 38px;
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .store-fixed-nav {
    left: 6px;
    top: 12px;
    gap: 6px;
  }
  .store-nav-btn {
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
}
.store-item-currency img { width: 14px; height: 14px; }

.store-tier.available {
  border-color: var(--border-accent);
  cursor: pointer;
}

.store-tier.available:hover {
  border-color: rgba(140, 80, 255, .7);
  background: rgba(140, 80, 255, .12);
  box-shadow: 0 0 14px rgba(140, 80, 255, .2);
}
.store-tiers {
  display: flex;
  gap: 8px;
}

.store-tier {
  flex: 1;
  padding: 8px 6px;
  text-align: center;
  font-family: 'Orbitron', sans-serif;
  font-size: 10px;
  background: rgba(255, 255, 255, .03);
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 8px;
  cursor: pointer;
  transition: .3s;
  color: rgba(255, 255, 255, .7);
  line-height: 1.4;
}

.store-tier:hover {
  border-color: var(--border-accent);
  background: rgba(140, 80, 255, .08);
}

.store-tier:active { transform: scale(0.96); }

.store-tier.purchased {
  border-color: rgba(76, 175, 80, .3);
  background: rgba(76, 175, 80, .08);
  cursor: default;
  pointer-events: none;
}

.store-tier-label {
  font-weight: 700;
  font-size: 11px;
  color: #c084fc;
  margin-bottom: 3px;
}

.store-tier.purchased .store-tier-label {
  color: rgba(76, 175, 80, .8);
}
.store-tier.purchased .store-tier-price {
  text-decoration: line-through;
  opacity: 0.4;
}
.store-tier.purchased::after {
  content: "✓";
  display: block;
  color: rgba(76, 175, 80, .7);
  font-size: 14px;
  margin-top: 2px;
}

.store-tier-price {
  font-size: 10px;
  opacity: .7;
  margin-top: 2px;
}
/* Тир — заблокирован (ещё не доступен) */
.store-tier.locked {
  opacity: 0.25;
  cursor: default;
  pointer-events: none;
  border-color: rgba(255, 255, 255, .04);
}

.store-tier.locked .store-tier-label {
  color: rgba(255, 255, 255, .3);
}

.store-tier.locked .store-tier-price {
  opacity: 0.3;
}

/* Consumable кнопка — куплен */
.store-single-buy.purchased {
  border-color: rgba(76, 175, 80, .3);
  background: rgba(76, 175, 80, .06);
  color: rgba(76, 175, 80, .7);
  cursor: default;
  pointer-events: none;
}

.store-single-buy {
  padding: 10px 16px;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: rgba(251, 191, 36, .06);
  border: 1px solid rgba(251, 191, 36, .25);
  border-radius: var(--radius);
  cursor: pointer;
  transition: .3s;
  text-align: center;
  width: 100%;
}

.store-single-buy:hover {
  box-shadow: 0 0 15px rgba(251, 191, 36, .15);
  border-color: rgba(251, 191, 36, .45);
}

.store-single-buy:active { transform: scale(0.96); }

.store-single-buy.purchased {
  border-color: rgba(76, 175, 80, .3);
  background: rgba(76, 175, 80, .06);
  color: rgba(76, 175, 80, .7);
  cursor: default;
}

/* Footer */
footer {
  position: relative;
  margin-top: 30px;
  padding-bottom: 25px;
  text-align: center;
  font-size: 11px;
  line-height: 1.8;
  z-index: var(--z-hero);
  opacity: .6;
}

footer a { color: #c084fc; text-decoration: none; transition: .3s; }
footer a:hover { color: #e0b0ff; }

.footer-socials {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 10px;
}

.footer-social-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, .5);
  text-decoration: none;
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(255, 255, 255, .08);
  transition: .3s;
}

.footer-social-link:hover {
  color: #1DA1F2;
  border-color: rgba(29, 161, 242, .3);
  box-shadow: 0 0 10px rgba(29, 161, 242, .15);
}

/* Dark screen */
#darkScreen {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000;
  z-index: 9999;
}
/* Store back — фиксированная слева по центру */
.store-back-fixed {
  position: fixed;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 110;

  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;

  font-family: 'Orbitron', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);

  background: var(--glass);
  backdrop-filter: blur(14px);
  border: 1px solid var(--border-accent);
  border-radius: 50%;
  cursor: pointer;
  transition: .3s;
}

.store-back-fixed:hover {
  box-shadow: 0 0 20px rgba(140, 80, 255, .3);
  transform: translateY(-50%) scale(1.08);
  border-color: rgba(140, 80, 255, .7);
}

.store-back-fixed:active {
  transform: translateY(-50%) scale(0.94);
}
/* Мобильная адаптация */
@media (max-width: 768px) {
  .store-back-fixed {
    left: 10px;
    width: 38px;
    height: 38px;
    font-size: 16px;
  }
}

@media (max-width: 768px) {
  #storeScreen {
    padding: 20px 15px 20px 55px;
  }
}

@media (max-width: 480px) {
  #storeScreen {
    padding: 15px 10px 15px 48px;
  }
}
@media (max-width: 480px) {
  .store-back-fixed {
    left: 8px;
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
}
/* =========================
   ANIMATIONS
========================= */
@keyframes starMove {
  from { transform: translateY(0) }
  to { transform: translateY(-1000px) }
}

@keyframes twinkle {
  0% { opacity: .4 }
  100% { opacity: .8 }
}

@keyframes fadeIn { to { opacity: 1 } }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px) }
  to { opacity: 1; transform: translateY(0) }
}

@keyframes pulseGlow {
  0%, 100% { opacity: .5; transform: scale(1) }
  50% { opacity: .8; transform: scale(1.08) }
}

@keyframes eyeFlicker {
  0%   { filter: drop-shadow(0 0 8px rgba(137, 72, 190, .4)); }
  50%  { filter: drop-shadow(0 0 20px rgba(255, 69, 0, .6)); }
  100% { filter: drop-shadow(0 0 12px rgba(93, 82, 141, .24)); }
}

@keyframes float {
  from { transform: translateY(0) }
  to { transform: translateY(-200px); opacity: 0 }
}

/* =========================
   RESPONSIVE
========================= */
@media (max-width: 768px) {
  .bear-wrapper {
    width: 250vw; max-width: 800px;
    height: 250vw; max-height: 800px;
    margin-top: -120px; margin-bottom: -200px;
  }
  .new-title { font-size: 28px; margin-top: -20px; }
  .new-buttons { max-width: 90%; padding: 0 15px; margin-top: 15px; gap: 12px; }
  .btn-new { padding: 13px 25px; font-size: 13px; }
  .lb { max-width: 92%; padding: 15px; margin-top: 20px; }
  .lb-title { font-size: 12px; }
  .lb-row { font-size: 11px; padding: 8px 8px; }
  .toggle-row { padding: 4px 10px; gap: 6px; }
  .toggle-label { font-size: 10px; min-width: 50px; }
  .switch { width: 34px; height: 20px; }
  .slider:before { height: 14px; width: 14px; }
  input:checked + .slider:before { transform: translateX(14px); }
  .go-title { font-size: 30px; }
  .go-reason { font-size: 13px; }
  .go-stats { max-width: 90%; padding: 15px 18px; }
  .go-stat-row { font-size: 12px; padding: 8px 0; }
  .go-btn { padding: 12px 25px; font-size: 12px; }
  .store-title { font-size: 20px; }
  .store-item-name { font-size: 12px; }
  .store-tier { font-size: 9px; padding: 6px 4px; }
  footer { margin-top: 15px; font-size: 9px; }
}

@media (max-width: 480px) {
  .bear-wrapper {
    width: 300vw; max-width: 600px;
    height: 300vw; max-height: 600px;
    margin-top: -100px; margin-bottom: -170px;
  }
  .new-title { font-size: 24px; }
  .btn-new { padding: 12px 20px; font-size: 12px; }
  .lb { max-width: 95%; }
  .go-title { font-size: 24px; }
  .go-btn { padding: 10px 20px; font-size: 11px; }
  .store-title { font-size: 18px; }
  .store-tiers { gap: 5px; }
}

@media (max-width: 360px) {
  .bear-wrapper {
    width: 350vw; max-width: 500px;
    height: 350vw; max-height: 500px;
    margin-top: -80px; margin-bottom: -140px;
  }
  .new-title { font-size: 20px; }
  .btn-new { padding: 10px 15px; font-size: 11px; }
}

@supports (padding: max(0px)) {
  body {
    padding-left: max(0px, env(safe-area-inset-left));
    padding-right: max(0px, env(safe-area-inset-right));
    padding-top: max(0px, env(safe-area-inset-top));
    padding-bottom: max(0px, env(safe-area-inset-bottom));
  }
}
</style>
</head>
<body>

<!-- ===== Global toggle sound ===== -->
<div id="audioTogglesGlobal">
  <div class="toggle-row" id="sfxToggleRow">
    <span class="toggle-label">🔊 Effects</span>
    <label class="switch">
      <input type="checkbox" id="sfxToggle" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row" id="musicToggleRow">
    <span class="toggle-label">🎵 Music</span>
    <label class="switch">
      <input type="checkbox" id="musicToggle" checked>
      <span class="slider"></span>
    </label>
  </div>
</div>

<!-- ===== WALLET + INFO ===== -->
<div id="walletCorner">
  <button class="wallet-btn-corner" id="walletBtn">Connect Wallet</button>
  <div class="wallet-info" id="walletInfo">
    <div class="wallet-info-row">🏆 <span class="val" id="walletRank">—</span></div>
    <div class="wallet-info-row">⭐ <span class="val" id="walletBest">0</span></div>
    <div class="wallet-info-row"><img src="img/icon_gold.png"> <span class="val-gold" id="walletGold">0</span></div>
    <div class="wallet-info-row"><img src="img/icon_silver.png"> <span class="val-silver" id="walletSilver">0</span></div>
  </div>
</div>

<!-- ===== BACKGROUND LAYER ===== -->
<div class="stars"></div>
<div class="stars2"></div>
<div class="vignette"></div>

<!-- ===== GAME CONTAINER ===== -->
<div id="gameContainer">
  <div id="gameWrapper">
    <div id="gameContent">
      <canvas id="game"></canvas>

      <div id="uiTopLeft">
        <div class="distance">🛹 <span id="distanceVal">0</span>м</div>
        <div class="score">⭐ <span id="scoreVal">0</span></div>
        <div style="margin-top: 8px; font-size: 11px; opacity: 0.7; border-top: 1px solid rgba(255,255,255,.06); padding-top: 6px;">
          <div>📊 FPS: <span id="fpsVal">60</span></div>
          <div id="pingDisplay" style="display: none;">🌐 Ping: <span id="pingVal">0</span>ms</div>
        </div>
      </div>

      <div id="uiTopRight">
        <div><span class="label">🛡</span><span class="value" id="shieldVal">✗</span></div>
        <div><span class="label">🧲</span><span class="value" id="magnetVal">OFF</span></div>
        <div><span class="label">🔄</span><span class="value" id="invertVal">OK</span></div>
        <div><span class="label">✖</span><span class="value" id="multiplierVal">x1</span></div>
        <div style="border-top: 1px solid rgba(255,255,255,.06); margin-top: 5px; padding-top: 5px;">
          <span class="label">SPIN:</span><span class="value" id="spinVal">✓</span>
        </div>
      </div>

      <div id="uiBottomCenter">
        <div class="coins-row">
          <div class="coin">
            <img src="img/icon_gold.png" style="width: 24px; height: 24px; vertical-align: middle;">
            <span class="count" id="goldVal">0</span>
          </div>
          <div class="coin">
            <img src="img/icon_silver.png" style="width: 24px; height: 24px; vertical-align: middle;">
            <span class="count" id="silverVal">0</span>
          </div>
        </div>
        <div class="speed-info">⚡ <span id="speedVal">1.0x</span> | 📊 <span id="coinsCountVal">0</span> coins</div>
      </div>
        <!-- In-game audio toggles -->
      <div class="game-audio-nav">
        <button class="game-audio-btn" id="gameSfxBtn" onclick="toggleSfxMute()" title="Sound Effects">🔊</button>
        <button class="game-audio-btn" id="gameMusicBtn" onclick="toggleMusicMute()" title="Music">🎵</button>
      </div>

    </div>
  </div>
</div>

<!-- ===== GAME START ===== -->
<div id="gameStart">

  <div class="bear-wrapper" id="bear3d">
    <img src="img/glow.png" class="layer glow">
    <img src="img/bear.png" class="layer bear">
    <img src="img/eyes.png" class="layer eyes">
    <div class="particle" style="left: 40%; bottom: 20%"></div>
    <div class="particle" style="left: 55%; bottom: 25%"></div>
    <div class="particle" style="left: 50%; bottom: 18%"></div>
  </div>

  <div class="new-title">URSAS TUBE</div>

  <div class="new-buttons">
    <button class="btn-new btn-new-store" id="storeBtn" onclick="showStore()" style="display: none;">STORE</button>
    <button class="btn-new btn-new-primary" id="startBtn" onclick="startGame()">START GAME</button>
    <div id="ridesInfo" style="display: none; flex-direction: column; align-items: center; gap: 4px; margin-top: 12px;">
    <span id="ridesText" style="font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.8);">🎟 3 races</span>
    <span id="ridesTimer" style="font-family: 'Orbitron', sans-serif; font-size: 11px; color: #fbbf24; display: none;">⏰ Recover in 0h 0m</span>
  </div>
  </div>

  <div class="lb" id="startLeaderboardWrap">
    <div class="lb-title">🏆 TOP</div>
    <div class="lb-list" id="startLeaderboardList">
      <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
      <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
      <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
      <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
      <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
    </div>
  </div>

  <footer>
    <div class="footer-socials">
      <a href="https://x.com/yourproject" target="_blank" class="footer-social-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
    </div>
    Team<br>
    © 2026 Ursass Tube — Powered by Justconnect
  </footer>
</div>

<!-- ===== GAME OVER ===== -->
<div id="gameOver">
  <div class="go-backdrop"></div>

  <div class="go-title">GAME OVER</div>

  <div class="go-reason">
    <span class="go-reason-text" id="goReason"></span>
  </div>

  <div class="go-stats">
    <div class="go-stat-row">
      <span class="go-stat-label">🛹 Distance</span>
      <span class="go-stat-value" id="goDistance">0 м</span>
    </div>
    <div class="go-stat-row">
      <span class="go-stat-label">⭐ Score</span>
      <span class="go-stat-value" id="goScore">0</span>
    </div>
    <div class="go-stat-row">
      <span class="go-stat-label"><img src="img/icon_gold.png" style="width: 18px; height: 18px; vertical-align: middle;"> Gold</span>
      <span class="go-stat-value coins-gold" id="goGold">0</span>
    </div>
    <div class="go-stat-row">
      <span class="go-stat-label"><img src="img/icon_silver.png" style="width: 18px; height: 18px; vertical-align: middle;"> Silver</span>
      <span class="go-stat-value coins-silver" id="goSilver">0</span>
    </div>
    <div class="go-stat-row">
      <span class="go-stat-label">⏱ Time</span>
      <span class="go-stat-value" id="goTime">0s</span>
    </div>
  </div>

  <div class="go-buttons">
    <button class="go-btn go-btn-restart" onclick="restartFromGameOver()">🔁 RESTART</button>
    <button class="go-btn go-btn-menu" onclick="goToMainMenu()">🏠 MENU</button>
  </div>

  <div class="go-lb-wrap">
    <div class="lb">
      <div class="lb-title">🏆 TOP</div>
      <div class="lb-list" id="gameOverLeaderboardList">
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
        <div class="skeleton-row"><div class="skeleton-block skeleton-rank"></div><div class="skeleton-block skeleton-wallet"></div><div class="skeleton-block skeleton-score"></div></div>
      </div>
    </div>
  </div>
</div>

<!-- ===== STORE ===== -->
<div id="storeScreen">

   <!-- Фиксированная кнопка BACK слева по центру -->
  <div class="store-fixed-nav">
    <button class="store-nav-btn" id="storeSfxBtn" onclick="toggleSfxMute()" title="Sound Effects">🔊</button>
    <button class="store-nav-btn" id="storeMusicBtn" onclick="toggleMusicMute()" title="Music">🎵</button>
    <button class="store-nav-btn" onclick="hideStore()" title="Back">←</button>
  </div>
  <div class="store-header">
    <div class="store-title">🛒 STORE</div>
    <div class="store-coins">
      <div class="store-coin-display">
        <img src="img/icon_gold.png">
        <span class="store-gold-val" id="storeGoldVal">0</span>
      </div>
      <div class="store-coin-display">
        <img src="img/icon_silver.png">
        <span class="store-silver-val" id="storeSilverVal">0</span>
      </div>
    </div>
  </div>

  <div class="store-list">

    <!-- === GOLD ITEMS (единичные, наверху) === -->

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🛡 Shield — start with shield</span>
        <span class="store-item-currency"><img src="img/icon_gold.png"> GOLD</span>
      </div>
      <button class="store-single-buy" id="store-shield" onclick="buyUpgrade('shield', 0)">
        🛡 Buy — <img src="img/icon_gold.png" style="width: 14px; height: 14px; vertical-align: middle;"> 10
      </button>
    </div>


    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🎟 Races — pack of three races</span>
        <span class="store-item-currency"><img src="img/icon_gold.png"> GOLD</span>
      </div>
      <button class="store-single-buy" id="store-rides_pack" onclick="buyUpgrade('rides_pack', 0)">
        🎟 Buy — <img src="img/icon_gold.png" style="width: 14px; height: 14px; vertical-align: middle;"> 10
      </button>
    </div>

    <!-- === SILVER ITEMS (3 тира) === -->

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">✖2 Score — X2 multiplier duration</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-x2-0" onclick="buyUpgrade('x2_duration', 0)">
          <div class="store-tier-label">+5s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-x2-1" onclick="buyUpgrade('x2_duration', 1)">
          <div class="store-tier-label">+10s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-x2-2" onclick="buyUpgrade('x2_duration', 2)">
          <div class="store-tier-label">+15s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">➕ Score +500 — upper multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-item-header">
        <span class="store-item-name">➕ Score +300 — upper multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-scoreplus-0" onclick="buyUpgrade('score_plus_mult', 0)">
          <div class="store-tier-label">x1.5</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-scoreplus-1" onclick="buyUpgrade('score_plus_mult', 1)">
          <div class="store-tier-label">x1.7</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-scoreplus-2" onclick="buyUpgrade('score_plus_mult', 2)">
          <div class="store-tier-label">x2.0</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">➖ Score −300— lower multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-item-header">
        <span class="store-item-name">➖ Score −500 — lower multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-scoreminus-0" onclick="buyUpgrade('score_minus_mult', 0)">
          <div class="store-tier-label">x0.9</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-scoreminus-1" onclick="buyUpgrade('score_minus_mult', 1)">
          <div class="store-tier-label">x0.7</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-scoreminus-2" onclick="buyUpgrade('score_minus_mult', 2)">
          <div class="store-tier-label">x0.5</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🔄 Invert — bonus score</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-invert-0" onclick="buyUpgrade('invert_score', 0)">
          <div class="store-tier-label">x1.5</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-invert-1" onclick="buyUpgrade('invert_score', 1)">
          <div class="store-tier-label">x1.7</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-invert-2" onclick="buyUpgrade('invert_score', 2)">
          <div class="store-tier-label">x2.0</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">⚡ Speed Up — speed upper multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-speedup-0" onclick="buyUpgrade('speed_up_mult', 0)">
          <div class="store-tier-label">x2</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-speedup-1" onclick="buyUpgrade('speed_up_mult', 1)">
          <div class="store-tier-label">x3</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-speedup-2" onclick="buyUpgrade('speed_up_mult', 2)">
          <div class="store-tier-label">x4</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🐌 Speed Down — speed lower multiplier</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-speeddown-0" onclick="buyUpgrade('speed_down_mult', 0)">
          <div class="store-tier-label">x2</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-speeddown-1" onclick="buyUpgrade('speed_down_mult', 1)">
          <div class="store-tier-label">x3</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-speeddown-2" onclick="buyUpgrade('speed_down_mult', 2)">
          <div class="store-tier-label">x4</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>

    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🧲 Magnet — magnet duration</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-magnet-0" onclick="buyUpgrade('magnet_duration', 0)">
          <div class="store-tier-label">+5s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-magnet-1" onclick="buyUpgrade('magnet_duration', 1)">
          <div class="store-tier-label">+5s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-magnet-2" onclick="buyUpgrade('magnet_duration', 2)">
          <div class="store-tier-label">+5s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>
    <div class="store-item">
      <div class="store-item-header">
        <span class="store-item-name">🔄 Spin — spin recharge duration</span>
        <span class="store-item-currency"><img src="img/icon_silver.png"> SILVER</span>
      </div>
      <div class="store-tiers">
        <div class="store-tier" id="store-spincooldown-0" onclick="buyUpgrade('spin_cooldown', 0)">
          <div class="store-tier-label">-2s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-spincooldown-1" onclick="buyUpgrade('spin_cooldown', 1)">
          <div class="store-tier-label">-3s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
        <div class="store-tier" id="store-spincooldown-2" onclick="buyUpgrade('spin_cooldown', 2)">
          <div class="store-tier-label">-5s</div>
          <div class="store-tier-price">🪙 100</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Dark screen -->
<div id="darkScreen"></div>    
</head>

<script>
/* ===== CONFIG ===== */
const BACKEND_URL = "https://ursassbackend-production.up.railway.app";
console.log(`🔗 Backend URL: ${BACKEND_URL}`);

const CONFIG = {
  LANES: [-1, 0, 1],
  TUBE_RADIUS: 260,
  PLAYER_OFFSET: 0.75,
  PLAYER_Z: 0.18,
  FRAME_SIZE: 64,

  SPEED_MIN: 0.01,
  SPEED_MAX: 0.12,
  SPEED_START: 0.025,
  SPEED_INCREMENT: 0.0004,
  SPEED_INCREMENT_INTERVAL: 100,
  SPEED_BONUS_AMOUNT: 0.004,

  TUBE_SEGMENTS: 48,
  TUBE_DEPTH_STEPS: 60,
  TUBE_Z_STEP: 0.03,
  BASE_ROTATION_SPEED: 1.2,
  MAX_ROTATION_SPEED: 3,

  COIN_SPAWN_INTERVAL: 1400,
  COIN_SPACING: [15, 30, 60],
  OBSTACLE_SPACING: [20, 40, 80],
  BONUS_SPACING: [70, 150, 300],
  MAX_OBSTACLES: 8,
  MAX_BONUSES: 4,
  MAX_COINS: 15,

  ANIM_SPEED: 0.15,
  LANE_COOLDOWN_FRAMES: 8,
  LANE_TRANSITION_FRAMES: 6,
  SPIN_COOLDOWN_TIME: 1800,
  SPIN_DURATION: 0.6,

  MIN_CURVE_TIME: 5000,
  MAX_CURVE_TIME: 15000,
  MAX_CURVE_ANGLE: 0.45,
  CURVE_OFFSET_X: 0.35,
  CURVE_OFFSET_Y: 0.25,

  TEX_SIZE: 256,
  TEX_PIXEL_SIZE: 8
};

const BONUS_TYPES = {
  SHIELD: "shield",
  X2: "x2",
  SPEED_DOWN: "speed_down",
  SPEED_UP: "speed_up",
  MAGNET: "magnet",
  INVERT: "invert",
  RECHARGE: "recharge",
  SCORE_300: "score_300",
  SCORE_500: "score_500",
  SCORE_MINUS_300: "score_minus_300",
  SCORE_MINUS_500: "score_minus_500"
};

/* ===== DOM CACHE ===== */
const DOM = {
  canvas: document.getElementById("game"),
  gameStart: document.getElementById("gameStart"),
  gameOver: document.getElementById("gameOver"),

  distanceVal: document.getElementById("distanceVal"),
  scoreVal: document.getElementById("scoreVal"),
  shieldVal: document.getElementById("shieldVal"),
  magnetVal: document.getElementById("magnetVal"),
  invertVal: document.getElementById("invertVal"),
  multiplierVal: document.getElementById("multiplierVal"),
  spinVal: document.getElementById("spinVal"),
  goldVal: document.getElementById("goldVal"),
  silverVal: document.getElementById("silverVal"),
  speedVal: document.getElementById("speedVal"),
  coinsCountVal: document.getElementById("coinsCountVal"),

  walletBtn: document.getElementById("walletBtn"),
  walletInfo: document.getElementById("walletInfo"),
  walletRank: document.getElementById("walletRank"),
  walletBest: document.getElementById("walletBest"),
  walletGold: document.getElementById("walletGold"),
  walletSilver: document.getElementById("walletSilver"),

  startBtn: document.getElementById("startBtn"),
  storeBtn: document.getElementById("storeBtn")
};

const ctx = DOM.canvas.getContext("2d", { alpha: false, antialias: false });

/* ===== PERFORMANCE MONITOR ===== */
class PerformanceMonitor {
  constructor() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 60;
    this.avgFps = 60;
    this.fpsHistory = [];
    this.lastPingTime = 0;
    this.currentPing = 0;
  }

  updateFPS() {
    const now = performance.now();
    const deltaTime = now - this.lastTime;

    if (deltaTime >= 1000) {
      this.fps = Math.round(this.frameCount * 1000 / deltaTime);
      this.fpsHistory.push(this.fps);

      if (this.fpsHistory.length > 10) {
        this.fpsHistory.shift();
      }

      this.avgFps = Math.round(
        this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
      );

      this.frameCount = 0;
      this.lastTime = now;
      this.updateFpsUI();
    }

    this.frameCount++;
  }

  updateFpsUI() {
    const fpsVal = document.getElementById('fpsVal');
    fpsVal.textContent = this.fps;
    fpsVal.classList.remove('slow', 'critical');

    if (this.fps < 30) {
      fpsVal.classList.add('critical');
    } else if (this.fps < 45) {
      fpsVal.classList.add('slow');
    }
  }

  async measurePing() {
    try {
      const startTime = performance.now();

      await fetch(`${BACKEND_URL}/health`, {
        method: 'GET',
        cache: 'no-store'
      });

      const endTime = performance.now();
      this.currentPing = Math.round(endTime - startTime);
      this.updatePingUI();

    } catch (e) {
      console.warn("⚠️ Не удалось измерить ping:", e);
      this.currentPing = 0;
    }
  }

  updatePingUI() {
    const pingDisplay = document.getElementById('pingDisplay');
    const pingVal = document.getElementById('pingVal');

    pingDisplay.style.display = 'block';
    pingVal.textContent = this.currentPing;
    pingVal.classList.remove('slow', 'critical');

    if (this.currentPing > 200) {
      pingVal.classList.add('critical');
    } else if (this.currentPing > 100) {
      pingVal.classList.add('slow');
    }
  }
}

const perfMonitor = new PerformanceMonitor();

/* ===== ASSET MANAGER ===== */
class AssetManager {
  constructor() {
    this.assets = {};
    this.loading = 0;
    this.loaded = 0;
  }

  async loadAll() {
    return Promise.all([
      this.loadImage('obstacles_1', 'assets/obstacles_1.png'),
      this.loadImage('obstacles_2', 'assets/obstacles_2.png'),
      this.loadImage('obstacles_3', 'assets/obstacles_3.png'),
      this.loadImage('coins_gold', 'assets/coins_gold.png'),
      this.loadImage('coins_silver', 'assets/coins_silver.png'),
      this.loadImage('bonus_shield', 'assets/bonus_shield.png'),
      this.loadImage('bonus_speed', 'assets/bonus_speed.png'),
      this.loadImage('bonus_magnet', 'assets/bonus_magnet.png'),
      this.loadImage('bonus_chkey', 'assets/bonus_chkey.png'),
      this.loadImage('bonus_score_plus', 'assets/bonus_score_plus.png'),
      this.loadImage('bonus_score_minus', 'assets/bonus_score_minus.png'),
      this.loadImage('bonus_recharge', 'assets/bonus_recharge.png'),
      this.loadImage('character_back_idle', 'assets/character_back_idle.png'),
      this.loadImage('character_left_idle', 'assets/character_left_idle.png'),
      this.loadImage('character_right_idle', 'assets/character_right_idle.png'),
      this.loadImage('character_left_swipe', 'assets/character_left_swipe.png'),
      this.loadImage('character_right_swipe', 'assets/character_right_swipe.png'),
      this.loadImage('character_spin', 'assets/character_spin.png')
    ]);
  }

  loadImage(name, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.assets[name] = img;
        this.loaded++;
        resolve(img);
      };
      img.onerror = () => {
        console.error(`Failed to load ${name}: ${src}`);
        this.loaded++;
        resolve(null);
      };
      img.src = src;
      this.loading++;
    });
  }

  getAsset(name) {
    return this.assets[name];
  }

  isReady() {
    return this.loaded === this.loading && this.loading > 0;
  }

  getProgress() {
    return this.loading === 0 ? 0 : (this.loaded / this.loading) * 100;
  }
}

const assetManager = new AssetManager();

/* ===== AUDIO MANAGER ===== */
const audioManager = {
  sfx: {},
  music: {},
  currentMusic: null,
  currentMusicName: null,

  init() {
    this.sfx.bad_bonus = new Audio("assets/sfx/bad_bonus.wav");
    this.sfx.coin = new Audio("assets/sfx/coin.wav");
    this.sfx.good_bonus = new Audio("assets/sfx/good_bonus.wav");
    this.sfx.gamestart = new Audio("assets/sfx/gemestart.wav");
    this.sfx.gameover = new Audio("assets/sfx/game-over.mp3");
    this.sfx.spin = new Audio("assets/sfx/crush__lose_gm.wav");
    this.sfx.gameover_screen = new Audio("assets/sfx/gameover screan.wav");
    this.sfx.gameover_screen.loop = true;

    this.music.menu = new Audio("assets/sound/BlackUrsa.ogg");
    this.music.menu.loop = true;
    this.music.game1 = new Audio("assets/sound/Pixel Overdrive 1.ogg");
    this.music.game2 = new Audio("assets/sound/Pixel Overdrive 2.ogg");
    this.music.game3 = new Audio("assets/sound/Pixel Overdrive 3.ogg");

    ["game1", "game2", "game3"].forEach(key => {
      this.music[key].addEventListener("ended", () => {
        if (gameState.running) {
          this.playRandomGameMusic();
        }
      });
    });

    this.applyVolumes();
  },

  applyVolumes() {
    const sfxVol = audioSettings.sfxEnabled ? 1 : 0;
    const musicVol = audioSettings.musicEnabled ? 1 : 0;
    Object.values(this.sfx).forEach(s => { s.volume = sfxVol; });
    Object.values(this.music).forEach(m => { m.volume = musicVol; });
  },

  playSFX(name) {
    const s = this.sfx[name];
    if (!s) return;
    s.volume = audioSettings.sfxEnabled ? 1 : 0;
    s.currentTime = 0;
    s.play().catch(() => {});
  },

  stopSFX(name) {
    const s = this.sfx[name];
    if (!s) return;
    s.pause();
    s.currentTime = 0;
  },

  playMusic(name) {
    this.stopMusic();
    const m = this.music[name];
    if (!m) return;
    m.volume = audioSettings.musicEnabled ? 1 : 0;
    m.currentTime = 0;
    m.play().catch(() => {});
    this.currentMusic = m;
    this.currentMusicName = name;
  },

  stopMusic() {
    if (this.currentMusic) {
      this.currentMusic.pause();
      this.currentMusic.currentTime = 0;
      this.currentMusic = null;
      this.currentMusicName = null;
    }
  },

  playRandomGameMusic() {
    const tracks = ["game1", "game2", "game3"];
    let pick;
    do {
      pick = tracks[Math.floor(Math.random() * tracks.length)];
    } while (pick === this.currentMusicName && tracks.length > 1);
    this.playMusic(pick);
  },

  stopAll() {
    this.stopMusic();
    Object.values(this.sfx).forEach(s => {
      s.pause();
      s.currentTime = 0;
    });
  }
};

const audioSettings = {
  sfxEnabled: true,
  musicEnabled: true
};
/* ===== AUDIO TOGGLE SYSTEM ===== */

function setSfxEnabled(enabled) {
  audioSettings.sfxEnabled = enabled;
  const vol = enabled ? 1 : 0;
  Object.values(audioManager.sfx).forEach(s => { s.volume = vol; });
  localStorage.setItem("sfxEnabled", String(enabled));
  syncAllAudioUI();
  console.log("🔊 SFX:", enabled);
}

function setMusicEnabled(enabled) {
  audioSettings.musicEnabled = enabled;
  const vol = enabled ? 1 : 0;
  Object.values(audioManager.music).forEach(m => { m.volume = vol; });
  localStorage.setItem("musicEnabled", String(enabled));
  syncAllAudioUI();
  console.log("🎵 Music:", enabled);
}

function toggleSfxMute() {
  setSfxEnabled(!audioSettings.sfxEnabled);
}

function toggleMusicMute() {
  setMusicEnabled(!audioSettings.musicEnabled);
}

function syncAllAudioUI() {
  // Global toggle
  const sfxCb = document.getElementById("sfxToggle");
  const musicCb = document.getElementById("musicToggle");
  const sfxRow = document.getElementById("sfxToggleRow");
  const musicRow = document.getElementById("musicToggleRow");

  if (sfxCb) sfxCb.checked = audioSettings.sfxEnabled;
  if (musicCb) musicCb.checked = audioSettings.musicEnabled;
  if (sfxRow) sfxRow.classList.toggle("active", audioSettings.sfxEnabled);
  if (musicRow) musicRow.classList.toggle("active", audioSettings.musicEnabled);

  // Store round buttons
  const storeSfx = document.getElementById("storeSfxBtn");
  const storeMusic = document.getElementById("storeMusicBtn");
  if (storeSfx) {
    storeSfx.textContent = audioSettings.sfxEnabled ? "🔊" : "🔇";
    storeSfx.classList.toggle("muted", !audioSettings.sfxEnabled);
  }
  if (storeMusic) {
    storeMusic.textContent = audioSettings.musicEnabled ? "🎵" : "🔇";
    storeMusic.classList.toggle("muted", !audioSettings.musicEnabled);
  }

  // In-game round buttons
  const gameSfx = document.getElementById("gameSfxBtn");
  const gameMusic = document.getElementById("gameMusicBtn");
  if (gameSfx) {
    gameSfx.textContent = audioSettings.sfxEnabled ? "🔊" : "🔇";
    gameSfx.classList.toggle("muted", !audioSettings.sfxEnabled);
  }
  if (gameMusic) {
    gameMusic.textContent = audioSettings.musicEnabled ? "🎵" : "🔇";
    gameMusic.classList.toggle("muted", !audioSettings.musicEnabled);
  }
}

function initAudioToggles() {
  // Global checkbox 
  const sfxCb = document.getElementById("sfxToggle");
  const musicCb = document.getElementById("musicToggle");

  if (sfxCb) {
    sfxCb.addEventListener("change", () => {
      setSfxEnabled(sfxCb.checked);
    });
  }

  if (musicCb) {
    musicCb.addEventListener("change", () => {
      setMusicEnabled(musicCb.checked);
    });
  }

  syncAllAudioUI();
}

function restoreAudioSettings() {
  const sfxSaved = localStorage.getItem("sfxEnabled");
  const musicSaved = localStorage.getItem("musicEnabled");

  if (sfxSaved !== null) audioSettings.sfxEnabled = (sfxSaved === "true");
  if (musicSaved !== null) audioSettings.musicEnabled = (musicSaved === "true");

  audioManager.applyVolumes();
  syncAllAudioUI();
}

/* ===== PARTICLE SYSTEM ===== */
class Particle {
  constructor(x, y, vx, vy, color, life = 30) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = life;
    this.age = 0;
    this.size = 5;
    this.active = true;
  }

  update() {
    if (!this.active) return false;
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.2;
    this.age++;

    if (this.age >= this.life) {
      this.active = false;
      return false;
    }
    return true;
  }

  draw(context) {
    if (!this.active) return;
    const alpha = 1 - (this.age / this.life);
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = this.color;
    context.beginPath();
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  reset(x, y, vx, vy, color, life) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = life;
    this.age = 0;
    this.size = 5;
    this.active = true;
  }
}

class ParticlePool {
  constructor(maxParticles = 300) {
    this.maxParticles = maxParticles;
    this.particles = [];
    this.activeIndex = 0;

    for (let i = 0; i < maxParticles; i++) {
      this.particles.push(new Particle(0, 0, 0, 0, "white", 30));
    }
  }

  spawn(x, y, color, count = 8, speed = 5) {
    if (!isFinite(x) || !isFinite(y)) return;

    for (let i = 0; i < count; i++) {
      const particleIndex = (this.activeIndex + i) % this.maxParticles;
      const particle = this.particles[particleIndex];
      const angle = (Math.PI * 2 * i) / count;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      particle.reset(x, y, vx, vy, color, 30);
    }

    this.activeIndex = (this.activeIndex + count) % this.maxParticles;
  }

  update() {
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].active) {
        this.particles[i].update();
      }
    }
  }

  draw(context) {
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].active) {
        this.particles[i].draw(context);
      }
    }
  }

  clear() {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].active = false;
    }
    this.activeIndex = 0;
  }
}

const particlePool = new ParticlePool(300);

function spawnParticles(x, y, color, count = 8, speed = 5) {
  particlePool.spawn(x, y, color, count, speed);
}

function updateParticles() {
  particlePool.update();
}

function drawParticles() {
  particlePool.draw(ctx);
}

/* ===== ANIMATIONS ===== */
const Animations = {
  idle_back: {
    atlas: 'character_back_idle',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 12,
    colsPerRow: 6
  },
  idle_left: {
    atlas: 'character_left_idle',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 12,
    colsPerRow: 6
  },
  idle_right: {
    atlas: 'character_right_idle',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 12,
    colsPerRow: 6
  },
  swipe_left: {
    atlas: 'character_left_swipe',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 3,
    colsPerRow: 3
  },
  swipe_right: {
    atlas: 'character_right_swipe',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 3,
    colsPerRow: 3
  },
  spin: {
    atlas: 'character_spin',
    spriteWidth: 128,
    spriteHeight: 128,
    frames: 14,
    colsPerRow: 7
  }
};

/* ===== CANVAS RESIZE ===== */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = DOM.canvas.parentElement.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) return;

  DOM.canvas.width = rect.width * dpr;
  DOM.canvas.height = rect.height * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);

/* ===== GAME STATE ===== */
const gameState = {
  running: false,
  distance: 0,
  score: 0,
  speed: CONFIG.SPEED_START,
  baseMultiplier: 1,
  silverCoins: 0,
  goldCoins: 0,

  lastTime: 0,
  deltaTime: 0,

  lastCoinSpawnDistance: 0,
  lastObstacleSpawnDistance: 0,
  lastObstacleDistance: 0,
  lastBonusDistance: 0,
  lastCoinDistance: 0,

  tubeRotation: 0,
  tubeScroll: 0,
  tubeWaveMod: 0,

  curveTimer: 0,
  curveDirection: 0,
  tubeCurveAngle: 0,
  tubeCurveStrength: 0,
  curveTransitionDuration: 0,

  spinActive: false,
  spinProgress: 0,
  spinCooldown: 0,

  bonusText: "",
  bonusTextTimer: 0,

  x2Timer: 0,
  uiUpdateFrame: 0,

  centerOffsetX: 0,
  centerOffsetY: 0,
  spinCooldownReduction: 0,
  invertScoreMultiplier: 1.0,
};

const player = {
  x: 0,
  y: 0,
  lane: 0,
  targetLane: 0,
  laneAnimFrame: 0,
  lanePrev: 0,
  isLaneTransition: false,
  state: "idle",
  frameIndex: 0,
  frameTimer: 0,
  shield: false,
  magnetActive: false,
  magnetTimer: 0,
  invertActive: false,
  invertTimer: 0,
  isSpin: false
};

const curves = {
  current: { direction: 0, strength: 0 },
  next: { direction: 0, strength: 0.5 }
};

const obstacles = [];
const bonuses = [];
const coins = [];
const inputQueue = [];

let laneCooldown = 0;
let bestScore = localStorage.getItem('bestScore') ? parseInt(localStorage.getItem('bestScore')) : 0;
let bestDistance = localStorage.getItem('bestDistance') ? parseInt(localStorage.getItem('bestDistance')) : 0;

let web3 = null;
let userWallet = null;
let isWalletConnected = false;

/* ===== PROJECTION ===== */
function project(lane, z, includeSpinRotation = false) {
  if (!isFinite(z)) z = CONFIG.PLAYER_Z;
  if (!isFinite(lane)) lane = 0;

  z = Math.max(0, Math.min(z, 2));
  lane = Math.max(-1, Math.min(lane, 1));

  const scale = Math.max(0.05, 1 - z);
  const tubeRadius = CONFIG.TUBE_RADIUS * scale;

  let angle = lane * 0.55;

  if (includeSpinRotation && gameState.spinActive) {
    const spinProgress = gameState.spinProgress / CONFIG.SPIN_DURATION;
    const spinRotation = spinProgress * Math.PI * 2;
    angle += spinRotation;
  }

  const x = DOM.canvas.width / 2 + Math.sin(angle) * tubeRadius;
  const y = DOM.canvas.height / 2 + Math.cos(angle) * tubeRadius * CONFIG.PLAYER_OFFSET;

  if (!isFinite(x) || !isFinite(y)) {
    return {
      x: DOM.canvas.width / 2,
      y: DOM.canvas.height / 2,
      scale: 1,
      angle: 0
    };
  }

  return { x, y, scale, angle };
}

function projectPlayer(z) {
  if (!isFinite(z)) z = CONFIG.PLAYER_Z;

  const scale = Math.max(0.05, 1 - z);
  const r = CONFIG.TUBE_RADIUS * scale;

  let angleLane = player.lane;

  if (player.isLaneTransition) {
    const t = player.laneAnimFrame / CONFIG.LANE_TRANSITION_FRAMES;
    angleLane = player.lanePrev + (player.targetLane - player.lanePrev) * t;
  }

  let spinRotation = 0;
  if (gameState.spinActive) {
    const spinProgress = gameState.spinProgress / CONFIG.SPIN_DURATION;
    spinRotation = spinProgress * Math.PI * 2;
  }

  const angle = angleLane * 0.55 + spinRotation;

  const x = DOM.canvas.width / 2 + Math.sin(angle) * r;
  const y = DOM.canvas.height / 2 + Math.cos(angle) * r * CONFIG.PLAYER_OFFSET;

  if (!isFinite(x) || !isFinite(y)) {
    return {
      x: DOM.canvas.width / 2,
      y: DOM.canvas.height / 2,
      scale: 1,
      angle: 0
    };
  }

  return { x, y, scale, angle };
}

function getSpinFrameIndex(spinProgress, totalFrames) {
  const exactFrame = spinProgress * totalFrames;
  const frameIndex = Math.round(exactFrame) % totalFrames;
  return Math.max(0, frameIndex);
}

/* ===== INPUT HANDLERS ===== */
let touchStartX = 0;

document.addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });

document.addEventListener("touchmove", e => {
  if (!gameState.running) return;
  const diff = e.touches[0].clientX - touchStartX;
  if (Math.abs(diff) > 50) {
    inputQueue.push(diff < 0 ? -1 : 1);
    touchStartX = e.touches[0].clientX;
  }
}, { passive: true });

let lastTap = 0;
document.addEventListener("touchend", e => {
  const now = Date.now();
  if (now - lastTap < 300 && !gameState.spinActive && !player.isLaneTransition) {
    triggerSpin();
  }
  lastTap = now;
}, { passive: true });

document.addEventListener("keydown", e => {
  if (!gameState.running) return;

  if (e.code === "ArrowLeft") {
    inputQueue.push(player.invertActive ? 1 : -1);
  } else if (e.code === "ArrowRight") {
    inputQueue.push(player.invertActive ? -1 : 1);
  } else if (e.code === "Space") {
    if (!gameState.spinActive && !player.isLaneTransition && gameState.spinCooldown <= 0) {
      triggerSpin();
    }
  }
});

/* ===== WALLET ===== */
DOM.walletBtn.onclick = connectWallet;

function disconnectWallet() {
  console.log("🔌 Wallet disconnecting...");
  isWalletConnected = false;
  userWallet = null;
  web3 = null;

  DOM.walletBtn.textContent = "Connect Wallet";
  DOM.walletBtn.classList.remove("connected");
  DOM.walletBtn.onclick = connectWallet;

  DOM.walletInfo.classList.remove("visible");
  DOM.walletRank.textContent = "—";
  DOM.walletBest.textContent = "0";
  DOM.walletGold.textContent = "0";
  DOM.walletSilver.textContent = "0";

  if (DOM.storeBtn) DOM.storeBtn.style.display = "none";

  console.log("✅ Wallet disconnect");
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      alert("❌ MetaMask not installed!");
      return;
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    if (!accounts || accounts.length === 0) {
      alert("❌ Wallet connection error");
      return;
    }

    userWallet = accounts[0];
    isWalletConnected = true;

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    web3 = provider;

    DOM.walletBtn.onclick = disconnectWallet;

    await updateWalletUI();
    showBonusText("✅ Wallet Connected!");
    await loadAndDisplayLeaderboard();
    await loadPlayerUpgrades();
    updateRidesDisplay();

  } catch (error) {
    console.error("Error:", error);
    if (error.code === 4001) {
      alert("❌ You have rejected the request");
    } else {
      alert(`❌ Error: ${error.message}`);
    }
  }
}

async function updateWalletUI() {
  if (isWalletConnected && userWallet) {
    DOM.walletBtn.textContent = `${userWallet.slice(0, 6)}...${userWallet.slice(-4)}`;
    DOM.walletBtn.classList.add("connected");
    DOM.walletBtn.onclick = disconnectWallet;

    if (DOM.storeBtn) DOM.storeBtn.style.display = "";

    try {
      const url = `${BACKEND_URL}/api/leaderboard/player/${userWallet}`;
      const response = await fetch(url);
      const playerData = await response.json();

      if (response.ok) {
        const bs = playerData.bestScore || 0;
        const pos = playerData.position || '—';
        const gold = playerData.totalGoldCoins || 0;
        const silver = playerData.totalSilverCoins || 0;

        DOM.walletRank.textContent = `#${pos}`;
        DOM.walletBest.textContent = bs;
        DOM.walletGold.textContent = gold;
        DOM.walletSilver.textContent = silver;
      } else {
        DOM.walletRank.textContent = "NEW";
        DOM.walletBest.textContent = "0";
        DOM.walletGold.textContent = "0";
        DOM.walletSilver.textContent = "0";
      }

      DOM.walletInfo.classList.add("visible");
      updateRidesDisplay();
    } catch (e) {
      console.error("❌ Error receiving data:", e);
      DOM.walletInfo.classList.add("visible");
    }
  } else {
    disconnectWallet();
  }
}

async function signMessage(message) {
  try {
    if (!isWalletConnected || !userWallet) {
      console.error("❌ Wallet not connected");
      return null;
    }

    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, userWallet]
    });

    return signature;
  } catch (error) {
    console.error("❌ Signature error:", error);
    return null;
  }
}

/* ===== STORE SYSTEM ===== */
let playerUpgrades = null;
let playerEffects = null;   
let playerBalance = { gold: 0, silver: 0 };

async function loadPlayerUpgrades() {
  if (!isWalletConnected || !userWallet) return;

  try {
    const url = `${BACKEND_URL}/api/store/upgrades/${userWallet}`;
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      playerUpgrades = data.upgrades;
      playerEffects = data.activeEffects;
      playerBalance = data.balance;

      // Rides
      if (data.rides) {
        playerRides = data.rides;
      }

      console.log("✅ Upgrades loaded:", playerUpgrades);
      console.log("✅ Effects:", playerEffects);
      console.log("✅ Balance:", playerBalance);
      console.log("🎟 Races:", playerRides);
    }
  } catch (e) {
    console.error("❌ Error loading upgrades:", e);
  }
}


function showStore() {
  if (!isWalletConnected) {
    alert("🔗 First, connect wallet!");
    return;
  }

  DOM.gameStart.classList.add("hidden");
  document.getElementById("storeScreen").classList.add("visible");

  document.getElementById("walletCorner").style.display = "none";
  document.getElementById("audioTogglesGlobal").style.display = "none";

  syncAllAudioUI();
  loadPlayerUpgrades().then(() => {
    updateStoreUI();
  });

  console.log("🛒 Store open");
}

function hideStore() {
  document.getElementById("storeScreen").classList.remove("visible");
  DOM.gameStart.classList.remove("hidden");

  document.getElementById("audioTogglesGlobal").style.display = "flex";
  document.getElementById("walletCorner").style.display = "flex";

  console.log("🛒 Store close");
}

function updateStoreUI() {
  // === BALANCE ===
  const goldEl = document.getElementById("storeGoldVal");
  const silverEl = document.getElementById("storeSilverVal");
  if (goldEl) goldEl.textContent = playerBalance.gold;
  if (silverEl) silverEl.textContent = playerBalance.silver;

  if (!playerUpgrades) return;

  // === ID MAPPING: upgradeKey → HTML prefix ===
  const idMap = {
    x2_duration: 'x2',
    score_plus_mult: 'scoreplus',
    score_minus_mult: 'scoreminus',
    invert_score: 'invert',
    speed_up_mult: 'speedup',
    speed_down_mult: 'speeddown',
    magnet_duration: 'magnet',
    spin_cooldown: 'spincooldown'
  };

  // === TIERED UPDATE (3 tir) ===
  for (const key in idMap) {
    const prefix = idMap[key];
    const data = playerUpgrades[key];
    if (!data) continue;

    for (let i = 0; i < data.maxLevel; i++) {
      const el = document.getElementById(`store-${prefix}-${i}`);
      if (!el) continue;

      el.classList.remove("purchased", "locked", "available");
      el.style.opacity = "";
      el.style.pointerEvents = "";
      el.onclick = null;

      if (i < data.currentLevel) {
        // ✅ КУПЛЕН — зелёная рамка, галочка, некликабелен
        el.classList.add("purchased");
        el.style.pointerEvents = "none";

      } else if (i === data.currentLevel) {
        // 🟣 ДОСТУПЕН К ПОКУПКЕ — фиолетовая рамка, кликабелен
        el.classList.add("available");
        const tierIndex = i;
        const upgradeKey = key;
        el.onclick = function() {
          buyUpgrade(upgradeKey, tierIndex);
        };

      } else {
        // 🔒 ЗАБЛОКИРОВАН — затемнён, некликабелен
        el.classList.add("locked");
        el.style.opacity = "0.25";
        el.style.pointerEvents = "none";
      }
    }
  }

  // === CONSUMABLE: SHIELD (перманентный, за голд) ===
  const shieldBtn = document.getElementById("store-shield");
  if (shieldBtn && playerUpgrades.shield) {
    // Сбрасываем
    shieldBtn.classList.remove("purchased");
    shieldBtn.style.opacity = "";
    shieldBtn.style.pointerEvents = "";
    shieldBtn.onclick = null;

    if (playerUpgrades.shield.currentLevel >= 1) {
      // Уже куплен навсегда
      shieldBtn.classList.add("purchased");
      shieldBtn.innerHTML = "✅ Куплено навсегда";
      shieldBtn.style.pointerEvents = "none";
    } else {
      // Доступен к покупке
      shieldBtn.onclick = function() {
        buyUpgrade('shield', 0);
      };
      shieldBtn.innerHTML = 'Купить — <img src="img/icon_gold.png" style="width: 14px; height: 14px; vertical-align: middle;"> 10';
    }
  }

  // === CONSUMABLE: RIDES PACK (за голд, накапливается) ===
    // === RIDES PACK ===
  const ridesBtn = document.getElementById("store-rides_pack");
  if (ridesBtn) {
    ridesBtn.classList.remove("purchased");
    ridesBtn.style.opacity = "";
    ridesBtn.style.pointerEvents = "";

    const free = playerRides.freeRides || 0;
    const paid = playerRides.paidRides || 0;
    const total = playerRides.totalRides || 0;

    let ridesLabel = `🎟 Заездов: ${total}`;
    if (paid > 0) ridesLabel += ` (${free} бесп. + ${paid} купл.)`;
    if (free < 3 && playerRides.resetInMs > 0) {
      ridesLabel += ` | ⏰ ${playerRides.resetInFormatted}`;
    }

    ridesBtn.innerHTML = ridesLabel + ' | Купить +3 — <img src="img/icon_gold.png" style="width: 14px; height: 14px; vertical-align: middle;"> 10';

    ridesBtn.onclick = function() {
      buyUpgrade('rides_pack', 0);
    };
  }
}

async function buyUpgrade(key, tier) {
  if (!isWalletConnected || !userWallet) {
    alert("🔗 Connect wallet!");
    return;
  }

  try {
    const timestamp = Date.now();
    const message = `Buy upgrade\nWallet: ${userWallet.toLowerCase()}\nUpgrade: ${key}\nTier: ${tier}\nTimestamp: ${timestamp}`;

    const signature = await signMessage(message);
    if (!signature) {
      alert("❌ Failed to sign transaction");
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/store/buy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet": userWallet
      },
      body: JSON.stringify({
        wallet: userWallet,
        upgradeKey: key,
        tier: tier,
        signature: signature,
        timestamp: timestamp
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      if (data.rides) {
        playerRides = data.rides;
        updateRidesDisplay();
      }
      console.log("✅ Purchase success:", data.message);

      // Обновляем локальный баланс
      playerBalance = data.balance;
      playerEffects = data.activeEffects;

      // Перезагружаем апгрейды
      await loadPlayerUpgrades();
      updateStoreUI();

      // Обновляем wallet info
      DOM.walletGold.textContent = playerBalance.gold;
      DOM.walletSilver.textContent = playerBalance.silver;

    } else {
      alert(`❌ ${data.error}`);
    }

  } catch (error) {
    console.error("❌ Purchase error:", error);
    alert("❌ Network error");
  }
}

/* ===== GAME FUNCTIONS ===== */
function areAllAssetsReady() {
  if (!assetManager.isReady()) return false;

  const criticalAssets = [
    'coins_gold', 'coins_silver',
    'obstacles_1', 'obstacles_2', 'obstacles_3',
    'bonus_shield', 'bonus_speed', 'bonus_magnet', 'bonus_chkey',
    'bonus_score_plus', 'bonus_score_minus', 'bonus_recharge',
    'character_back_idle', 'character_left_idle', 'character_right_idle',
    'character_left_swipe', 'character_right_swipe', 'character_spin'
  ];

  for (const assetName of criticalAssets) {
    if (!assetManager.getAsset(assetName)) return false;
  }

  return true;
}
async function startGame() {
  if (!areAllAssetsReady()) {
    showBonusText("⏳ Загружаю спрайты...");
    setTimeout(startGame, 500);
    return;
  }

  // Проверяем заезды ПЕРЕД тёмным экраном (только если кошелёк подключен)
  if (isWalletConnected) {
    await loadPlayerRides();

    if (playerRides.totalRides <= 0) {
      // Закрываем Game Over если он открыт
      audioManager.stopSFX("gameover_screen");
      DOM.gameOver.classList.remove("visible");
      document.getElementById("gameContainer").classList.remove("active");

      // Возвращаем на главную
      DOM.gameStart.classList.remove("hidden");
      document.getElementById("audioTogglesGlobal").style.display = "flex";
      document.getElementById("walletCorner").style.display = "flex";
      document.getElementById("darkScreen").style.display = "none";

      updateRidesDisplay();

      alert(`🎟 Нет заездов!\n⏰ Восстановление через ${playerRides.resetInFormatted}\n\n💰 Купите пак заездов в Store!`);
      return;
    }

    // Списываем 1 заезд
    const canPlay = await useRide();
    if (!canPlay) {
      // То же самое — на главную
      audioManager.stopSFX("gameover_screen");
      DOM.gameOver.classList.remove("visible");
      document.getElementById("gameContainer").classList.remove("active");

      DOM.gameStart.classList.remove("hidden");
      document.getElementById("audioTogglesGlobal").style.display = "flex";
      document.getElementById("walletCorner").style.display = "flex";
      document.getElementById("darkScreen").style.display = "none";

      updateRidesDisplay();

      alert(`🎟 Нет заездов!\n⏰ ${playerRides.resetInFormatted}\n\n💰 Купите пак в Store!`);
      return;
    }
  }

  // === Заезд списан, запускаем игру ===
  console.log("▶️ Запускаю игру...");
  audioManager.stopAll();

  const darkScreen = document.getElementById("darkScreen");
  darkScreen.style.display = "block";

  // Закрываем Game Over если был открыт
  DOM.gameOver.classList.remove("visible");

  audioManager.playSFX("gamestart");

  const onEnd = () => {
    audioManager.sfx.gamestart.removeEventListener("ended", onEnd);
    darkScreen.style.display = "none";
    actualStartGame();
  };
  audioManager.sfx.gamestart.addEventListener("ended", onEnd);

  setTimeout(() => {
    if (!gameState.running) {
      audioManager.sfx.gamestart.removeEventListener("ended", onEnd);
      darkScreen.style.display = "none";
      actualStartGame();
    }
  }, 5000);
}

function actualStartGame() {
  if (gameState.running) return;

  // Показываем игровой контейнер
  document.getElementById("gameContainer").classList.add("active");

  // Скрываем глобальные UI во время игры
  document.getElementById("walletCorner").style.display = "none";
  document.getElementById("audioTogglesGlobal").style.display = "none";

  // КРИТИЧЕСКИ ВАЖНО: пересчитать canvas ПОСЛЕ показа контейнера
  requestAnimationFrame(() => {
    resizeCanvas();

    resetGameSessionState();

    DOM.gameOver.classList.remove("visible");
    DOM.gameStart.classList.add("hidden");
    document.getElementById("storeScreen").classList.remove("visible");

    gameState.running = true;
    gameState.distance = 0;
    gameState.score = 0;
    gameState.speed = CONFIG.SPEED_START;
    gameState.baseMultiplier = 1;
    gameState.silverCoins = 0;
    gameState.goldCoins = 0;
    gameState.curveTimer = 0;
    gameState.lastTime = performance.now();

    gameState.lastObstacleDistance = 0;
    gameState.lastBonusDistance = 0;
    gameState.lastCoinSpawnDistance = 0;
    gameState.lastObstacleSpawnDistance = 0;

    curves.current.direction = 0;
    curves.current.strength = 0;
    curves.next.direction = Math.random() * Math.PI * 2;
    curves.next.strength = 0.5 + Math.random() * 0.5;

    player.lane = 0;
    player.targetLane = 0;
    player.shield = false;

    obstacles.length = 0;
    bonuses.length = 0;
    coins.length = 0;
    particlePool.clear();

    // === ПРИМЕНЯЕМ АПГРЕЙДЫ ИГРОКА ===
    if (playerEffects) {
      // Shield на старте — перманентный апгрейд
      if (playerEffects.start_with_shield) {
        player.shield = true;
        console.log("🛡 Start with shield");
      }

      // Spin cooldown сокращение (сохраняем для использования в triggerSpin)
      gameState.spinCooldownReduction = playerEffects.spin_cooldown_reduction || 0;

      // Invert score 
      gameState.invertScoreMultiplier = 1.0;

      console.log("✅ Upgrades applied:", {
        shield: playerEffects.start_with_shield,
        spinCooldownReduction: gameState.spinCooldownReduction,
        x2_duration_bonus: playerEffects.x2_duration_bonus || 0,
        magnet_duration_bonus: playerEffects.magnet_duration_bonus || 0,
        score_plus_multiplier: playerEffects.score_plus_multiplier || 1.0,
        score_minus_multiplier: playerEffects.score_minus_multiplier || 1.0,
        invert_score_multiplier: playerEffects.invert_score_multiplier || 1.0,
        speed_up_multiplier: playerEffects.speed_up_multiplier || 1.0,
        speed_down_multiplier: playerEffects.speed_down_multiplier || 1.0
      });
    } else {
      gameState.spinCooldownReduction = 0;
      gameState.invertScoreMultiplier = 1.0;
      console.log("⚪ No upgrades (wallet not connected or data not loaded)");
    }

    audioManager.playRandomGameMusic();

    console.log("✅ Game started!");
  });
}

function restartFromGameOver() {
  audioManager.stopSFX("gameover_screen");
  startGame();
}

function triggerSpin() {
  if (gameState.spinCooldown > 0 || gameState.spinActive || player.isLaneTransition || laneCooldown > 0) {
    return;
  }

  gameState.spinActive = true;
  gameState.spinProgress = 0;

  // Базовый кулдаун 1800 (30с в кадрах при 60fps), сокращаем по апгрейду
  const reductionFrames = (gameState.spinCooldownReduction || 0) * 60; // секунды → кадры
  gameState.spinCooldown = Math.max(600, CONFIG.SPIN_COOLDOWN_TIME - reductionFrames);

  player.isSpin = true;

  audioManager.playSFX("spin");
  spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(200, 100, 255, 1)", 25, 10);
}

function resetGameSessionState() {
  player.shield = false;
  player.magnetActive = false;
  player.magnetTimer = 0;
  player.invertActive = false;
  player.invertTimer = 0;
  player.isSpin = false;
  gameState.spinActive = false;
  gameState.spinProgress = 0;
  gameState.spinCooldown = 0;
  gameState.baseMultiplier = 1;
  gameState.x2Timer = 0;
  gameState.bonusText = "";
  gameState.bonusTextTimer = 0;
  player.frameIndex = 0;
  player.frameTimer = 0;
  player.state = "idle";
}

function endGame(reason = "Unknown") {
  resetGameSessionState();
  gameState.running = false;

  audioManager.stopMusic();

  spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(255, 0, 0, 1)", 30, 12);

  if ("vibrate" in navigator) {
    navigator.vibrate([100, 50, 100, 50, 200]);
  }

  const reasonMap = {
    pit: "🕳️ pit",
    spikes: "⚠️ spikes",
    bottles: "🍾 bottles",
    wall_brick: "🧱 wall brick",
    wall_kactus: "🌵 wall kactus",
    tree: "🌳 tree",
    rock1: "🪨 rock1",
    rock2: "🪨 rock2",
    fence: "🚧 fence",
    bull: "🐂 bull",
    spawn_error: "⚠️ Generation error",
  };
  const prettyReason = reasonMap[reason] || `❌ ${reason}`;

  if (gameState.score > bestScore) {
    bestScore = gameState.score;
    localStorage.setItem("bestScore", bestScore);
  }
  if (gameState.distance > bestDistance) {
    bestDistance = gameState.distance;
    localStorage.setItem("bestDistance", bestDistance);
  }

  saveResultToLeaderboard();

  const duration = ((gameState.distance / gameState.speed / 50) / 60).toFixed(1);

  const darkScreen = document.getElementById("darkScreen");
  darkScreen.style.display = "block";

    const showResult = () => {
    darkScreen.style.display = "none";

    document.getElementById("goReason").textContent = prettyReason;
    document.getElementById("goDistance").textContent = Math.floor(gameState.distance) + " м";
    document.getElementById("goScore").textContent = Math.floor(gameState.score);
    document.getElementById("goGold").textContent = gameState.goldCoins;
    document.getElementById("goSilver").textContent = gameState.silverCoins;
    document.getElementById("goTime").textContent = duration + "s";

    loadAndDisplayLeaderboard();

    document.getElementById("gameContainer").classList.remove("active");

    // Возвращаем глобальные UI
    document.getElementById("audioTogglesGlobal").style.display = "flex";
    document.getElementById("walletCorner").style.display = "flex";

    DOM.gameOver.classList.add("visible");

    audioManager.playSFX("gameover_screen");
  };

  audioManager.playSFX("gameover");

  const onEnd = () => {
    audioManager.sfx.gameover.removeEventListener("ended", onEnd);
    showResult();
  };
  audioManager.sfx.gameover.addEventListener("ended", onEnd);

  setTimeout(() => {
    audioManager.sfx.gameover.removeEventListener("ended", onEnd);
    if (!DOM.gameOver.classList.contains("visible")) {
      showResult();
    }
  }, 6000);
}

function goToMainMenu() {
  console.log("🏠 Return to main menu");

  audioManager.stopAll();

  DOM.gameOver.classList.remove("visible");
  DOM.gameStart.classList.remove("hidden");
  document.getElementById("storeScreen").classList.remove("visible");
  document.getElementById("gameContainer").classList.remove("active");

  // Возвращаем глобальные UI — явно flex
  document.getElementById("audioTogglesGlobal").style.display = "flex";
  document.getElementById("walletCorner").style.display = "flex";

  gameState.running = false;

  obstacles.length = 0;
  bonuses.length = 0;
  coins.length = 0;
  particlePool.clear();
  inputQueue.length = 0;

  player.lane = 0;
  player.targetLane = 0;
  player.shield = false;
  player.magnetActive = false;
  player.invertActive = false;
  player.isSpin = false;
  gameState.spinActive = false;
  gameState.spinProgress = 0;
  gameState.spinCooldown = 0;

  resetGameSessionState();

  audioManager.playMusic("menu");

   if (isWalletConnected) {
    loadPlayerRides().then(() => updateRidesDisplay());
  }
  console.log("✅ State has been reset");
}

/* ===== SPAWN FUNCTIONS ===== */
function getSpacing(type) {
  let spacing;
  if (type === "obstacle") {
    spacing = CONFIG.OBSTACLE_SPACING;
  } else if (type === "bonus") {
    spacing = CONFIG.BONUS_SPACING;
  } else if (type === "coin") {
    spacing = CONFIG.COIN_SPACING;
  } else {
    spacing = [30, 60, 120];
  }

  if (gameState.distance < 1000) return spacing[0];
  if (gameState.distance < 2000) return spacing[1];
  return spacing[2];
}

function isLaneOccupied(lane, checkZ, zRange = 0.3) {
  return obstacles.some(o => o.lane === lane && Math.abs(o.z - checkZ) < zRange) ||
         bonuses.some(b => b.lane === lane && Math.abs(b.z - checkZ) < zRange);
}

function spawnBonus() {
  if (bonuses.length >= CONFIG.MAX_BONUSES) return;

  const roll = Math.random();
  let type = BONUS_TYPES.SCORE_300;

  if (roll < 0.08) type = BONUS_TYPES.SHIELD;
  else if (roll < 0.15) type = BONUS_TYPES.SPEED_DOWN;
  else if (roll < 0.22) type = BONUS_TYPES.SPEED_UP;
  else if (roll < 0.30) type = BONUS_TYPES.MAGNET;
  else if (roll < 0.40) type = BONUS_TYPES.X2;
  else if (roll < 0.50) type = BONUS_TYPES.SCORE_500;
  else if (roll < 0.60) type = BONUS_TYPES.INVERT;
  else if (roll < 0.72) type = BONUS_TYPES.SCORE_300;
  else if (roll < 0.85) type = BONUS_TYPES.RECHARGE;
  else type = BONUS_TYPES.SCORE_MINUS_500;

  const spawnZ = 1.65;
  let lane = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const testLane = CONFIG.LANES[Math.floor(Math.random() * 3)];
    if (!isLaneOccupied(testLane, spawnZ)) {
      lane = testLane;
      break;
    }
  }

  if (lane !== null) {
    bonuses.push({ lane, z: spawnZ, size: 27, type, animFrame: 0 });
  }
}

function spawnObstacle() {
  if (obstacles.length >= CONFIG.MAX_OBSTACLES) return;

  const types = ["pit", "spikes", "bottles", "wall_brick", "wall_kactus", "tree", "rock1", "rock2", "fence", "bull"];
  const subtype = types[Math.floor(Math.random() * types.length)];

  const spawnZ = 1.65;

  let groupSize = 1;
  if (gameState.distance >= 1000) groupSize = Math.random() < 0.6 ? 2 : 1;
  if (gameState.distance >= 2000) groupSize = Math.random() < 0.7 ? 3 : 2;

  const availableLanes = [...CONFIG.LANES];

  for (let i = 0; i < groupSize && availableLanes.length > 0; i++) {
    let foundLane = null;

    for (let attempt = 0; attempt < 3 && availableLanes.length > 0; attempt++) {
      const idx = Math.floor(Math.random() * availableLanes.length);
      const testLane = availableLanes[idx];

      if (!isLaneOccupied(testLane, spawnZ + i * 0.15)) {
        foundLane = testLane;
        availableLanes.splice(idx, 1);
        break;
      }
    }

    if (foundLane === null && availableLanes.length > 0) {
      foundLane = availableLanes.pop();
    }

    if (foundLane !== null) {
      obstacles.push({
        lane: foundLane,
        z: spawnZ + i * 0.15,
        size: 39,
        subtype,
        animFrame: 0
      });
    }
  }
}

function spawnCoinPattern() {
  const patterns = [spawnCoinLine, spawnCoinSnake, spawnCoinDiagonal];
  patterns[Math.floor(Math.random() * patterns.length)]();
}

function spawnCoinLine() {
  const lane = CONFIG.LANES[Math.floor(Math.random() * 3)];
  const hasGold = Math.random() < 0.3;
  for (let i = 0; i < 3; i++) {
    coins.push({
      type: i === 0 && hasGold ? "gold" : "silver",
      lane,
      z: 1.55 - i * 0.1,
      animFrame: 0
    });
  }
}

function spawnCoinSnake() {
  const startLane = CONFIG.LANES[Math.floor(Math.random() * 3)];
  const hasGold = Math.random() < 0.3;
  coins.push({ type: hasGold ? "gold" : "silver", lane: startLane, z: 1.55, animFrame: 0 });
  coins.push({ type: "silver", lane: Math.max(-1, Math.min(1, startLane + (Math.random() < 0.5 ? -1 : 1))), z: 1.45, animFrame: 0 });
  coins.push({ type: "silver", lane: startLane, z: 1.35, animFrame: 0 });
}

function spawnCoinDiagonal() {
  const hasGold = Math.random() < 0.3;
  [-1, 0, 1].forEach((lane, i) => {
    coins.push({
      type: i === 0 && hasGold ? "gold" : "silver",
      lane,
      z: 1.55 - i * 0.1,
      animFrame: 0
    });
  });
}

function spawnCoinRing() {
  const hasGold = Math.random() < 0.35;
  const spawnZ = 1.35;

  // НИЗ — 3 монеты на полосах
  CONFIG.LANES.forEach((lane, i) => {
    coins.push({
      type: i === 1 && hasGold ? "gold" : "silver",
      lane: lane,
      z: spawnZ,
      animFrame: 0,
      isCircle: true
    });
  });

  // ВЕРХ — 3 монеты (только спином)
  const topAngles = [Math.PI - 0.3, Math.PI, Math.PI + 0.3];
  topAngles.forEach((angle) => {
    coins.push({
      type: "silver",
      z: spawnZ,
      angle: angle,
      radiusFactor: 0.65,
      isCircle: true,
      spinOnly: true,
      animFrame: 0
    });
  });

  // ЛЕВО — 3 монеты (только спином)
  const leftAngles = [Math.PI * 0.5 - 0.3, Math.PI * 0.5, Math.PI * 0.5 + 0.3];
  leftAngles.forEach((angle, i) => {
    coins.push({
      type: i === 1 && hasGold ? "gold" : "silver",
      z: spawnZ,
      angle: angle,
      radiusFactor: 0.65,
      isCircle: true,
      spinOnly: true,
      animFrame: 0
    });
  });

  // ПРАВО — 3 монеты (только спином)
  const rightAngles = [Math.PI * 1.5 - 0.3, Math.PI * 1.5, Math.PI * 1.5 + 0.3];
  rightAngles.forEach((angle) => {
    coins.push({
      type: "silver",
      z: spawnZ,
      angle: angle,
      radiusFactor: 0.65,
      isCircle: true,
      spinOnly: true,
      animFrame: 0
    });
  });
}

function spawnCoinCluster() {
  const lane = CONFIG.LANES[Math.floor(Math.random() * 3)];
  const hasGold = Math.random() < 0.3;

  const count = Math.random() < 0.5 ? 2 : 3;
  for (let i = 0; i < count; i++) {
    coins.push({
      type: i === 0 && hasGold ? "gold" : "silver",
      lane,
      z: 1.5 - i * 0.08,
      animFrame: 0
    });
  }
}

/* ===== UPDATE FUNCTION ===== */

function update(delta) {
  if (!isFinite(gameState.speed) || gameState.speed < 0) { endGame("Speed error"); return; }
  if (!isFinite(gameState.distance) || gameState.distance < 0) { endGame("Distance error"); return; }

  gameState.deltaTime = delta;

  const speedLevel = Math.floor(gameState.distance / CONFIG.SPEED_INCREMENT_INTERVAL);
  gameState.speed = Math.min(
    CONFIG.SPEED_START + speedLevel * CONFIG.SPEED_INCREMENT,
    CONFIG.SPEED_MAX
  );

  const METERS_PER_SECOND_MULT = 300;
  const metersDelta = gameState.speed * METERS_PER_SECOND_MULT * delta;
  gameState.distance += metersDelta;

  const basePointsPerMeter = 1;
  const speedFactor = gameState.speed / CONFIG.SPEED_START;
  let pointsPerMeter = basePointsPerMeter * speedFactor;

  // Invert бонус — множитель очков
  if (player.invertActive && gameState.invertScoreMultiplier > 1) {
    pointsPerMeter *= gameState.invertScoreMultiplier;
  }

  gameState.score += metersDelta * pointsPerMeter;

  // === СПАВН МОНЕТ ===
  const coinSpacing = getSpacing("coin");
  if (gameState.distance - gameState.lastCoinSpawnDistance > coinSpacing) {
    spawnCoinPattern();
    gameState.lastCoinSpawnDistance = gameState.distance;
  }

  // Кольцо монет каждые 100 метров
  if (Math.floor(gameState.distance / 100) > Math.floor((gameState.distance - metersDelta) / 100)) {
    spawnCoinRing();
  }

  // Кластеры монет (редко)
  if (Math.random() < 0.02 && coins.filter(c => c.type === "silver").length < 4) {
    spawnCoinCluster();
  }

  // === СПАВН ПРЕПЯТСТВИЙ ===
  const obstacleSpacing = getSpacing("obstacle");
  if (gameState.distance - gameState.lastObstacleDistance > obstacleSpacing) {
    spawnObstacle();
    gameState.lastObstacleDistance = gameState.distance;
    gameState.lastObstacleSpawnDistance = gameState.distance;
  }

  // === СПАВН БОНУСОВ ===
  const bonusSpacing = getSpacing("bonus");
  if (gameState.distance - gameState.lastBonusDistance > bonusSpacing) {
    spawnBonus();
    gameState.lastBonusDistance = gameState.distance;
  }

  // === АВАРИЙНАЯ ПРОВЕРКА ===
  if (gameState.distance - gameState.lastObstacleSpawnDistance > 600) {
    console.error("❌ Objects did not spawn 600m! Forced termination game.");
    endGame("spawn_error");
    return;
  }

  // === ДВИЖЕНИЕ ОБЪЕКТОВ ===
  const ANIM_STEP_SECONDS = 1 / 10;
  const COIN_ANIM_STEP_SECONDS = 1 / 8;

  for (const o of obstacles) {
    o.z -= gameState.speed * 0.45;
    o.animAcc = (o.animAcc || 0) + delta;
    if (o.animAcc >= ANIM_STEP_SECONDS) {
      o.animAcc -= ANIM_STEP_SECONDS;
      o.animFrame = (o.animFrame || 0) + 1;
    }
  }

  for (const b of bonuses) {
    b.z -= gameState.speed * 0.45;
    b.animAcc = (b.animAcc || 0) + delta;
    if (b.animAcc >= ANIM_STEP_SECONDS) {
      b.animAcc -= ANIM_STEP_SECONDS;
      b.animFrame = (b.animFrame || 0) + 1;
    }
  }

  for (const c of coins) {
    c.z -= gameState.speed * 0.8;
    c.animAcc = (c.animAcc || 0) + delta;
    if (c.animAcc >= COIN_ANIM_STEP_SECONDS) {
      c.animAcc -= COIN_ANIM_STEP_SECONDS;
      c.animFrame = (c.animFrame || 0) + 1;
    }
  }

  // === УДАЛЕНИЕ ВЫШЕДШИХ ЗА ЭКРАН ===
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].z <= -0.1) obstacles.splice(i, 1);
  }
  for (let i = bonuses.length - 1; i >= 0; i--) {
    if (bonuses[i].z <= -0.1) bonuses.splice(i, 1);
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    if (coins[i].z <= -0.1) coins.splice(i, 1);
  }

  // === ОБРАБОТКА ВВОДА ===
  if (laneCooldown <= 0 && inputQueue.length > 0 && !player.isLaneTransition) {
    if (gameState.spinActive) {
      inputQueue.shift();
    } else {
      const dir = inputQueue.shift();
      const newLane = Math.max(-1, Math.min(1, player.lane + dir));

      if (newLane !== player.lane) {
        player.lanePrev = player.lane;
        player.targetLane = newLane;
        player.laneAnimFrame = 0;
        player.isLaneTransition = true;
        player.state = "transition";
        player.frameIndex = 0;
        player.frameTimer = 0;
        laneCooldown = CONFIG.LANE_COOLDOWN_FRAMES;
      }
    }
  }

  if (laneCooldown > 0) laneCooldown--;

  // === АНИМАЦИЯ ПЕРЕХОДА LANE ===
  if (player.isLaneTransition) {
    player.laneAnimFrame++;
    if (player.laneAnimFrame >= CONFIG.LANE_TRANSITION_FRAMES) {
      player.lane = player.targetLane;
      player.isLaneTransition = false;
      player.state = "idle";
      player.frameIndex = 0;
      player.frameTimer = 0;
      inputQueue.length = 0;
    }
  }

  // === СПИН ===
  if (gameState.spinActive) {
    gameState.spinProgress += delta;
    player.state = "spin";

    if (gameState.spinProgress >= CONFIG.SPIN_DURATION) {
      gameState.spinActive = false;
      gameState.spinProgress = 0;
      player.isSpin = false;
      player.state = "idle";
      player.frameIndex = 0;
      player.frameTimer = 0;
    }
  }

  if (gameState.spinCooldown > 0) gameState.spinCooldown--;

  // === ТАЙМЕРЫ БОНУСОВ ===
  if (player.magnetActive) {
    player.magnetTimer -= delta;
    if (player.magnetTimer <= 0) player.magnetActive = false;
  }

  if (player.invertActive) {
    player.invertTimer -= delta;
    if (player.invertTimer <= 0) player.invertActive = false;
  }

  if (gameState.baseMultiplier > 1) {
    gameState.x2Timer -= delta;
    if (gameState.x2Timer <= 0) gameState.baseMultiplier = 1;
  }

  // === ПОЗИЦИЯ ИГРОКА ===
  const p = projectPlayer(CONFIG.PLAYER_Z);
  player.x = p.x - CONFIG.FRAME_SIZE / 2;
  player.y = p.y - CONFIG.FRAME_SIZE / 2;

  gameState.centerOffsetX = Math.cos(gameState.curveDirection) * gameState.tubeCurveStrength * CONFIG.TUBE_RADIUS * CONFIG.CURVE_OFFSET_X;
  gameState.centerOffsetY = Math.sin(gameState.curveDirection) * gameState.tubeCurveStrength * CONFIG.TUBE_RADIUS * CONFIG.CURVE_OFFSET_Y;

  // Тряска камеры от скорости
  const speedRatio = (gameState.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START);
  if (speedRatio > 0.3) {
    const shakeIntensity = (speedRatio - 0.3) * 4;
    gameState.centerOffsetX += (Math.random() - 0.5) * shakeIntensity;
    gameState.centerOffsetY += (Math.random() - 0.5) * shakeIntensity;
  }

  // === КОЛЛИЗИИ: ПРЕПЯТСТВИЯ ===
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    if (o.z >= CONFIG.PLAYER_Z - 0.035 && o.z <= CONFIG.PLAYER_Z + 0.035 && o.lane === player.lane) {
      if (player.shield) {
        player.shield = false;
        obstacles.splice(i, 1);
      } else {
        endGame(o.subtype);
        return;
      }
    }
  }

  // === КОЛЛИЗИИ: БОНУСЫ ===
  for (let i = bonuses.length - 1; i >= 0; i--) {
    const b = bonuses[i];
    if (b.z >= CONFIG.PLAYER_Z - 0.06 && b.z <= CONFIG.PLAYER_Z + 0.06 && b.lane === player.lane) {
      applyBonus(b);
      bonuses.splice(i, 1);
    }
  }

  // === КОЛЛИЗИИ: МОНЕТЫ ===
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.collected) continue;
    if (c.z < -0.5) { coins.splice(i, 1); continue; }

    let shouldCollect = false;

    // магнит
    if (player.magnetActive && c.z > 0.05 && c.z < 1.5) {
      const cp = typeof c.lane === "number" ? project(c.lane, c.z) : null;
      const playerPos = projectPlayer(CONFIG.PLAYER_Z);
      if (cp && playerPos) {
        const dist = Math.sqrt(Math.pow(cp.x - playerPos.x, 2) + Math.pow(cp.y - playerPos.y, 2));
        if (dist < 150) shouldCollect = true;
      }
    }

    // spinOnly монеты — ТОЛЬКО спином
    if (!shouldCollect && c.spinOnly && player.isSpin && c.z >= CONFIG.PLAYER_Z - 0.25 && c.z <= CONFIG.PLAYER_Z + 0.25) {
      shouldCollect = true;
    }

    // монеты isCircle (не spinOnly) — спином тоже можно
    if (!shouldCollect && !c.spinOnly && player.isSpin && (c.isCircleInner || c.isCircle) && c.z >= CONFIG.PLAYER_Z - 0.25 && c.z <= CONFIG.PLAYER_Z + 0.25) {
      shouldCollect = true;
    }

    // обычные монеты на lane
    if (!shouldCollect && !c.spinOnly && typeof c.lane === "number" && c.z >= CONFIG.PLAYER_Z - 0.15 && c.z <= CONFIG.PLAYER_Z + 0.15 && c.lane === player.lane) {
      shouldCollect = true;
    }

    if (shouldCollect) {
      collectCoin(c);
      coins.splice(i, 1);
    }
  }

  // === АНИМАЦИЯ ПЕРСОНАЖА ===
  updatePlayerAnimation(delta);

  // === КРИВЫЕ ТРУБЫ ===
  gameState.tubeWaveMod += 0.002;

  gameState.curveTimer += delta * 1000;
  const t = Math.min(1, gameState.curveTimer / gameState.curveTransitionDuration);
  const interp = (1 - Math.cos(Math.PI * t)) / 2;

  gameState.curveDirection = curves.current.direction * (1 - interp) + curves.next.direction * interp;
  gameState.tubeCurveStrength = curves.current.strength * (1 - interp) + curves.next.strength * interp;
  gameState.tubeCurveAngle = Math.cos(gameState.curveDirection) * gameState.tubeCurveStrength * CONFIG.MAX_CURVE_ANGLE;

  if (gameState.curveTimer >= gameState.curveTransitionDuration) {
    curves.current.direction = curves.next.direction;
    curves.current.strength = curves.next.strength;
    curves.next.direction = Math.random() * Math.PI * 2;
    curves.next.strength = 0.5 + Math.random() * 0.5;
    gameState.curveTransitionDuration = CONFIG.MIN_CURVE_TIME + Math.random() * (CONFIG.MAX_CURVE_TIME - CONFIG.MIN_CURVE_TIME);
    gameState.curveTimer = 0;
  }
}

/* ===== RIDES SYSTEM ===== */

let playerRides = {
  freeRides: 3,
  paidRides: 0,
  totalRides: 3,
  resetInMs: 0,
  resetInFormatted: "Ready"
};

async function loadPlayerRides() {
  if (!isWalletConnected || !userWallet) return;

  try {
    const response = await fetch(`${BACKEND_URL}/api/store/rides/${userWallet}`);
    const data = await response.json();
    if (response.ok) {
      playerRides = data;
      console.log("🎟 Заезды:", playerRides);
    }
  } catch (e) {
    console.error("❌ Ошибка загрузки заездов:", e);
  }
}

async function useRide() {
  if (!isWalletConnected || !userWallet) return true; // без кошелька — играй свободно

  try {
    const response = await fetch(`${BACKEND_URL}/api/store/use-ride`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: userWallet })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      playerRides = data.rides;
      updateRidesDisplay();
      console.log(`🎟 Заезд использован. Осталось: ${playerRides.totalRides}`);
      return true;
    } else {
      // Нет заездов
      playerRides = data.rides || playerRides;
      updateRidesDisplay();
      return false;
    }
  } catch (e) {
    console.error("❌ Ошибка списания заезда:", e);
    return true; // при ошибке сети — разрешаем играть
  }
}

function updateRidesDisplay() {
  // На главной — рядом с кнопкой Start
  const ridesInfo = document.getElementById("ridesInfo");
  if (!ridesInfo) return;

  if (!isWalletConnected) {
    ridesInfo.style.display = "none";
    return;
  }

  ridesInfo.style.display = "flex";

  const total = playerRides.totalRides;
  const free = playerRides.freeRides;
  const paid = playerRides.paidRides;

  const ridesText = document.getElementById("ridesText");
  const ridesTimer = document.getElementById("ridesTimer");

  if (ridesText) {
    ridesText.textContent = `🎟 ${total} race${total === 1 ? '' : total < 5 ? 'а' : 's'}`;
    if (paid > 0) {
      ridesText.textContent += ` (${free} free + ${paid} purchased)`;
    }
  }

  if (ridesTimer) {
    if (free < 3 && playerRides.resetInMs > 0) {
      ridesTimer.textContent = `⏰ Recover in ${playerRides.resetInFormatted}`;
      ridesTimer.style.display = "";
    } else {
      ridesTimer.style.display = "none";
    }
  }

  // Кнопка Start — блокируем если 0 заездов
  const startBtn = document.getElementById("startBtn");
  if (startBtn) {
    if (total <= 0) {
      startBtn.style.opacity = "0.4";
      startBtn.style.pointerEvents = "none";
      startBtn.textContent = `NO RACES (${playerRides.resetInFormatted})`;
    } else {
      startBtn.style.opacity = "";
      startBtn.style.pointerEvents = "";
      startBtn.textContent = "START GAME";
    }
  }
}

/* ===== BONUS & COINS ===== */
function applyBonus(bonus) {
  // Хелпер: получить эффект или дефолт
  const eff = (key, def) => (playerEffects && playerEffects[key] !== undefined) ? playerEffects[key] : def;

  const bonusMap = {
    [BONUS_TYPES.SHIELD]: () => {
      player.shield = true;
      showBonusText("🛡 Shield!");
      audioManager.playSFX("good_bonus");
      spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(100, 200, 255, 1)", 20, 8);
    },

    [BONUS_TYPES.SPEED_DOWN]: () => {
      const mult = eff('speed_down_multiplier', 1.0);
      const reduction = 0.01 * mult;
      gameState.speed = Math.max(gameState.speed - reduction, CONFIG.SPEED_MIN);
      showBonusText(`🐌 Slow! (x${mult})`);
      audioManager.playSFX("good_bonus");
    },

    [BONUS_TYPES.SPEED_UP]: () => {
      const mult = eff('speed_up_multiplier', 1.0);
      const increase = 0.01 * mult;
      gameState.speed = Math.min(gameState.speed + increase, CONFIG.SPEED_MAX);
      showBonusText(`⚡ Speed! (x${mult})`);
      audioManager.playSFX("good_bonus");
    },

    [BONUS_TYPES.MAGNET]: () => {
      player.magnetActive = true;
      const bonus = eff('magnet_duration_bonus', 0);
      player.magnetTimer = 7 + bonus;
      showBonusText(`🧲 Magnet! ${7 + bonus}s`);
      audioManager.playSFX("good_bonus");
      spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(255, 100, 200, 1)", 15, 7);
    },

    [BONUS_TYPES.INVERT]: () => {
      player.invertActive = true;
      player.invertTimer = 7;
      // Сохраняем множитель очков при инверте
      gameState.invertScoreMultiplier = eff('invert_score_multiplier', 1.0);
      showBonusText(`🔄 Inverted! (x${gameState.invertScoreMultiplier})`);
      audioManager.playSFX("bad_bonus");
    },

    [BONUS_TYPES.X2]: () => {
      gameState.baseMultiplier = 2;
      const bonus = eff('x2_duration_bonus', 0);
      gameState.x2Timer = 7 + bonus;
      showBonusText(`✖2 Score! ${7 + bonus}s`);
      audioManager.playSFX("good_bonus");
    },

    [BONUS_TYPES.SCORE_300]: () => {
      const mult = eff('score_plus_multiplier', 1.0);
      const points = Math.floor(300 * mult * gameState.baseMultiplier);
      gameState.score += points;
      showBonusText(`+${points}`);
      audioManager.playSFX("good_bonus");
    },

    [BONUS_TYPES.SCORE_500]: () => {
      const mult = eff('score_plus_multiplier', 1.0);
      const points = Math.floor(500 * mult * gameState.baseMultiplier);
      gameState.score += points;
      showBonusText(`+${points}`);
      audioManager.playSFX("good_bonus");
    },

    [BONUS_TYPES.SCORE_MINUS_300]: () => {
      const mult = eff('score_minus_multiplier', 1.0);
      const penalty = Math.floor(300 * mult);
      gameState.score = Math.max(0, gameState.score - penalty);
      showBonusText(`-${penalty} ❌`);
      audioManager.playSFX("bad_bonus");
      spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(255, 100, 100, 1)", 12, 6);
    },

    [BONUS_TYPES.SCORE_MINUS_500]: () => {
      const mult = eff('score_minus_multiplier', 1.0);
      const penalty = Math.floor(500 * mult);
      gameState.score = Math.max(0, gameState.score - penalty);
      showBonusText(`-${penalty} ❌`);
      audioManager.playSFX("bad_bonus");
      spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(255, 100, 100, 1)", 12, 6);
    },

    [BONUS_TYPES.RECHARGE]: () => {
      gameState.spinCooldown = 0;
      showBonusText("🔄 Spin Ready!");
      audioManager.playSFX("good_bonus");
      spawnParticles(DOM.canvas.width / 2, DOM.canvas.height / 2, "rgba(0, 255, 200, 1)", 15, 7);
    },
  };

  const handler = bonusMap[bonus.type];
  if (handler) handler();
}

function collectCoin(coin) {
  if (coin.collected) return;
  coin.collected = true;

  let particleX = DOM.canvas.width / 2;
  let particleY = DOM.canvas.height / 2;

  if (coin.lane !== undefined) {
    const p = project(coin.lane, coin.z);
    if (p) { particleX = p.x; particleY = p.y; }
  }

  if (coin.type === "silver") {
    gameState.score += 10 * gameState.baseMultiplier;
    gameState.silverCoins++;
    audioManager.playSFX("coin");
    spawnParticles(particleX, particleY, "rgba(200, 200, 200, 1)", 8, 4);
  } else if (coin.type === "gold" || coin.type === "gold_spin") {
    gameState.score += 100 * gameState.baseMultiplier;
    gameState.goldCoins++;
    audioManager.playSFX("coin");
    spawnParticles(particleX, particleY, "rgba(255, 215, 0, 1)", 12, 6);
  }
}

function showBonusText(text) {
  gameState.bonusText = text;
  gameState.bonusTextTimer = 90;
}

function updatePlayerAnimation(delta) {
  if (gameState.spinActive) return;

  player.frameTimer += delta;

  const anim = getCurrentAnimation();
  if (!anim) return;

  const frameDuration = 0.3;

  if (player.frameTimer >= frameDuration) {
    player.frameTimer -= frameDuration;
    player.frameIndex += 1;
  }
}

function getCurrentAnimation() {
  if (gameState.spinActive) return null;

  if (player.state === "transition") {
    return player.targetLane < player.lane
      ? Animations.swipe_left
      : Animations.swipe_right;
  }

  switch (player.lane) {
    case -1: return Animations.idle_left;
    case 1: return Animations.idle_right;
    default: return Animations.idle_back;
  }
}

/* ===== DRAWING ===== */

function getSegmentColor(angle, index) {
  const hue = (angle * 180 / Math.PI + index * 8) % 360;
  const r = 140 + Math.sin(hue * Math.PI / 180) * 30;
  const g = 60 + Math.cos(hue * Math.PI / 180) * 20;
  const b = 70 + Math.sin(hue * Math.PI / 180 * 0.5) * 25;

  return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
}

class TubeRenderer {
  draw() {
    const rotSpeed = Math.min(CONFIG.BASE_ROTATION_SPEED * gameState.speed * 18, CONFIG.MAX_ROTATION_SPEED);
    gameState.tubeRotation += rotSpeed * 0.01;
    gameState.tubeScroll += gameState.speed * 40;

    const centerOffsetX = gameState.centerOffsetX;
    const centerOffsetY = gameState.centerOffsetY;

    for (let d = CONFIG.TUBE_DEPTH_STEPS - 1; d >= 0; d--) {
      const z1 = d * CONFIG.TUBE_Z_STEP;
      const z2 = (d + 1) * CONFIG.TUBE_Z_STEP;
      const scale1 = 1 - z1;
      const scale2 = 1 - z2;

      if (scale2 <= 0) continue;

      const innerR = CONFIG.TUBE_RADIUS * 0.15;
      const r1 = Math.max(innerR, CONFIG.TUBE_RADIUS * scale1);
      const r2 = Math.max(innerR, CONFIG.TUBE_RADIUS * scale2);

      for (let i = 0; i < CONFIG.TUBE_SEGMENTS; i++) {
        const u = i / CONFIG.TUBE_SEGMENTS;
        const uNext = (i + 1) / CONFIG.TUBE_SEGMENTS;

        const baseAngle1 = u * Math.PI * 2 + gameState.tubeRotation;
        const baseAngle2 = uNext * Math.PI * 2 + gameState.tubeRotation;

        const angle1 = baseAngle1 + gameState.tubeCurveAngle;
        const angle2 = baseAngle2 + gameState.tubeCurveAngle;

        const bendInf1 = 1 - scale1;
        const bendInf2 = 1 - scale2;

        const x1 = DOM.canvas.width / 2 + Math.sin(angle1) * r1 + centerOffsetX * bendInf1;
        const y1 = DOM.canvas.height / 2 + Math.cos(angle1) * r1 * CONFIG.PLAYER_OFFSET + centerOffsetY * bendInf1;

        const x2 = DOM.canvas.width / 2 + Math.sin(angle2) * r1 + centerOffsetX * bendInf1;
        const y2 = DOM.canvas.height / 2 + Math.cos(angle2) * r1 * CONFIG.PLAYER_OFFSET + centerOffsetY * bendInf1;

        const x3 = DOM.canvas.width / 2 + Math.sin(angle2) * r2 + centerOffsetX * bendInf2;
        const y3 = DOM.canvas.height / 2 + Math.cos(angle2) * r2 * CONFIG.PLAYER_OFFSET + centerOffsetY * bendInf2;

        const x4 = DOM.canvas.width / 2 + Math.sin(angle1) * r2 + centerOffsetX * bendInf2;
        const y4 = DOM.canvas.height / 2 + Math.cos(angle1) * r2 * CONFIG.PLAYER_OFFSET + centerOffsetY * bendInf2;

        ctx.fillStyle = getSegmentColor(baseAngle1, i);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

const tubeRenderer = new TubeRenderer();

function drawTube() {
  tubeRenderer.draw();
}

function drawTubeDepth() {
  const cx = DOM.canvas.width / 2 + gameState.centerOffsetX;
  const cy = DOM.canvas.height / 2 + gameState.centerOffsetY;

  if (!isFinite(cx) || !isFinite(cy)) return;

  const grad = ctx.createRadialGradient(cx, cy, CONFIG.TUBE_RADIUS * 0.1, cx, cy, CONFIG.TUBE_RADIUS);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.15, "rgba(0,0,0,0.7)");
  grad.addColorStop(0.4, "rgba(0,0,0,0.3)");
  grad.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, CONFIG.TUBE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function drawTubeCenter() {
  const cx = DOM.canvas.width / 2 + gameState.centerOffsetX;
  const cy = DOM.canvas.height / 2 + gameState.centerOffsetY;

  if (!isFinite(cx) || !isFinite(cy)) return;

  const outerR = CONFIG.TUBE_RADIUS * 0.18;

  const grad1 = ctx.createRadialGradient(cx, cy, CONFIG.TUBE_RADIUS * 0.08, cx, cy, outerR);
  grad1.addColorStop(0, "rgba(20,20,40,0.9)");
  grad1.addColorStop(0.5, "rgba(40,20,50,0.7)");
  grad1.addColorStop(1, "rgba(30,10,30,0.4)");

  ctx.fillStyle = grad1;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fill();

  const grad2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, CONFIG.TUBE_RADIUS * 0.08);
  grad2.addColorStop(0, "rgba(10,5,15,1)");
  grad2.addColorStop(1, "rgba(20,10,25,0.8)");

  ctx.fillStyle = grad2;
  ctx.beginPath();
  ctx.arc(cx, cy, CONFIG.TUBE_RADIUS * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(100,60,80,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, CONFIG.TUBE_RADIUS * 0.15, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlayer() {
  const p = projectPlayer(CONFIG.PLAYER_Z);

  let frameX = 0;
  let frameY = 0;
  let spriteWidth = 128;
  let spriteHeight = 128;
  let playerAtlas = null;

  if (gameState.spinActive && gameState.spinProgress >= 0) {
    const anim = Animations.spin;

    playerAtlas = assetManager.getAsset(anim.atlas);
    if (!playerAtlas) return;

    spriteWidth = anim.spriteWidth;
    spriteHeight = anim.spriteHeight;

    const spinProgress = gameState.spinProgress / CONFIG.SPIN_DURATION;
    const currentFrame = getSpinFrameIndex(spinProgress, anim.frames);

    frameX = currentFrame % anim.colsPerRow;
    frameY = Math.floor(currentFrame / anim.colsPerRow);

  } else {
    const anim = getCurrentAnimation();

    if (!anim) return;

    playerAtlas = assetManager.getAsset(anim.atlas);
    if (!playerAtlas) return;

    spriteWidth = anim.spriteWidth;
    spriteHeight = anim.spriteHeight;

    const totalFrames = anim.frames;
    const currentFrame = Math.round(player.frameIndex) % totalFrames;

    frameX = currentFrame % anim.colsPerRow;
    frameY = Math.floor(currentFrame / anim.colsPerRow);
  }

  const displaySize = spriteWidth * 1.2;
  const screenX = p.x - displaySize / 2;
  const screenY = p.y - displaySize / 2;

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + displaySize * 0.3, displaySize * 0.6, displaySize * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(
    playerAtlas,
    frameX * spriteWidth,
    frameY * spriteHeight,
    spriteWidth,
    spriteHeight,
    screenX,
    screenY,
    displaySize,
    displaySize
  );
}

function drawCoins() {
  if (!Array.isArray(coins) || coins.length === 0) return;

  const centerOffsetX = gameState.centerOffsetX;
  const centerOffsetY = gameState.centerOffsetY;

  const SPRITE_W = CONFIG.FRAME_SIZE;
  const SPRITE_H = CONFIG.FRAME_SIZE;
  const FRAMES = 4;

  for (const c of coins) {
    if (c.collected) continue;

    let p = null;

    if (typeof c.angle === "number") {
      const scale = Math.max(0.05, 1 - c.z);
      const r = CONFIG.TUBE_RADIUS * scale * (c.radiusFactor || 0.65);
      const angle = c.angle + gameState.tubeRotation;

      p = {
        x: DOM.canvas.width / 2 + Math.sin(angle) * r,
        y: DOM.canvas.height / 2 + Math.cos(angle) * r * CONFIG.PLAYER_OFFSET,
        scale: scale
      };

      if (p.scale < 0.15) continue;

    } else if (typeof c.lane === "number") {
      p = project(c.lane, c.z, false);
      if (!p || p.scale <= 0.01) continue;
      if (p.scale < 0.15) continue;
    } else {
      continue;
    }

    const bendInf = 1 - p.scale;
    const offsetX = centerOffsetX * bendInf;
    const offsetY = centerOffsetY * bendInf;

    const isGold = c.type === "gold" || c.type === "gold_spin";
    const atlasName = isGold ? "coins_gold" : "coins_silver";
    const atlas = assetManager.getAsset(atlasName);
    if (!atlas) continue;

    const frame = (c.animFrame || 0) % FRAMES;
    const sx = frame * SPRITE_W;

    const sz = Math.max(18, SPRITE_W * p.scale * (isGold ? 1.0 : 0.95));

    const dx = Math.round(p.x - sz / 2 + offsetX);
    const dy = Math.round(p.y - sz / 2 + offsetY);

    if (c.spinOnly) {
      ctx.save();
      ctx.globalAlpha = 0.6 + Math.sin(Date.now() * 0.005) * 0.3;
      ctx.drawImage(atlas, sx, 0, SPRITE_W, SPRITE_H, dx, dy, sz, sz);
      ctx.restore();
    } else {
      ctx.drawImage(atlas, sx, 0, SPRITE_W, SPRITE_H, dx, dy, sz, sz);
    }
  }
}

function drawObjects() {
  const renderList = [];
  const centerOffsetX = gameState.centerOffsetX;
  const centerOffsetY = gameState.centerOffsetY;

  obstacles.forEach(o => {
    if (o.z > -0.2 && o.z < 1.6) renderList.push({ type: "obstacle", z: o.z, obj: o });
  });

  bonuses.forEach(b => {
    if (b.z > -0.2 && b.z < 1.6) renderList.push({ type: "bonus", z: b.z, obj: b });
  });

  renderList.sort((a, b) => b.z - a.z);

  const bonusFrameMap = {
    [BONUS_TYPES.SHIELD]: (frame) => ({ atlas: 'bonus_shield', spriteWidth: 64, spriteHeight: 64, col: frame % 4, row: 0 }),
    [BONUS_TYPES.SPEED_DOWN]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_speed', spriteWidth: 64, spriteHeight: 64, manualSX: slow === 0 ? 0 : 64, row: 0 };
    },
    [BONUS_TYPES.SPEED_UP]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_speed', spriteWidth: 64, spriteHeight: 64, manualSX: slow === 0 ? 128 : 192, row: 0 };
    },
    [BONUS_TYPES.MAGNET]: (frame) => ({ atlas: 'bonus_magnet', spriteWidth: 64, spriteHeight: 64, col: Math.floor(frame / 2) % 6, row: 0 }),
    [BONUS_TYPES.INVERT]: (frame) => ({ atlas: 'bonus_chkey', spriteWidth: 128, spriteHeight: 64, col: Math.floor(frame / 4) % 2, row: 0 }),
    [BONUS_TYPES.SCORE_300]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_score_plus', spriteWidth: slow === 0 ? 128 : 64, spriteHeight: 64, manualSX: slow === 0 ? 0 : 128, row: 0 };
    },
    [BONUS_TYPES.SCORE_500]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_score_plus', spriteWidth: slow === 0 ? 128 : 64, spriteHeight: 64, manualSX: slow === 0 ? 192 : 320, row: 0 };
    },
    [BONUS_TYPES.X2]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_score_plus', spriteWidth: slow === 0 ? 128 : 64, spriteHeight: 64, manualSX: slow === 0 ? 384 : 512, row: 0 };
    },
    [BONUS_TYPES.SCORE_MINUS_300]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_score_minus', spriteWidth: slow === 0 ? 128 : 64, spriteHeight: 64, manualSX: slow === 0 ? 0 : 128, row: 0 };
    },
    [BONUS_TYPES.SCORE_MINUS_500]: (frame) => {
      const slow = Math.floor(frame / 4) % 2;
      return { atlas: 'bonus_score_minus', spriteWidth: slow === 0 ? 128 : 64, spriteHeight: 64, manualSX: slow === 0 ? 192 : 320, row: 0 };
    },
    [BONUS_TYPES.RECHARGE]: (frame) => ({ atlas: 'bonus_recharge', spriteWidth: 64, spriteHeight: 64, manualSX: 0, row: 0 }),
  };

  const obstacleTypeMap = {
    fence: { atlas: 'obstacles_1', col: 0, row: 0 },
    rock1: { atlas: 'obstacles_1', col: 1, row: 0 },
    rock2: { atlas: 'obstacles_1', col: 2, row: 0 },
    bull:  { atlas: 'obstacles_1', col: 3, row: 0 },
    wall_brick: { atlas: 'obstacles_2', col: 0, row: 0 },
    wall_kactus: { atlas: 'obstacles_2', col: 1, row: 0 },
    tree:  { atlas: 'obstacles_2', col: 2, row: 0 },
    pit:   { atlas: 'obstacles_3', col: 0, row: 0 },
    spikes: { atlas: 'obstacles_3', col: 1, row: 0 },
    bottles: { atlas: 'obstacles_3', col: 2, row: 0 }
  };

  for (const item of renderList) {
    const o = item.obj;
    const p = project(o.lane, o.z);
    if (!p || p.scale <= 0.01) continue;

    const bendInf = 1 - p.scale;
    const offsetX = centerOffsetX * bendInf;
    const offsetY = centerOffsetY * bendInf;

    if (item.type === "obstacle") {
      const obstacleInfo = obstacleTypeMap[o.subtype];
      if (!obstacleInfo) continue;

      const atlasImage = assetManager.getAsset(obstacleInfo.atlas);
      if (!atlasImage) continue;

      const sz = Math.max(40, CONFIG.FRAME_SIZE * p.scale);

      ctx.drawImage(
        atlasImage,
        obstacleInfo.col * CONFIG.FRAME_SIZE,
        obstacleInfo.row * CONFIG.FRAME_SIZE,
        CONFIG.FRAME_SIZE,
        CONFIG.FRAME_SIZE,
        Math.round(p.x - sz / 2 + offsetX),
        Math.round(p.y - sz / 2 + offsetY),
        sz,
        sz
      );

    } else {
      const frameFn = bonusFrameMap[o.type];
      if (!frameFn) continue;

      const frameInfo = frameFn(o.animFrame || 0);

      const bonusAtlas = assetManager.getAsset(frameInfo.atlas);
      if (!bonusAtlas) continue;

      const baseSz = Math.max(15, CONFIG.FRAME_SIZE * p.scale * 0.9);
      const sz = frameInfo.spriteWidth === 128 ? baseSz * 1.2 : baseSz;

      const sx = frameInfo.manualSX !== undefined
        ? frameInfo.manualSX
        : frameInfo.col * frameInfo.spriteWidth;

      ctx.drawImage(
        bonusAtlas,
        sx,
        frameInfo.row * frameInfo.spriteHeight,
        frameInfo.spriteWidth,
        frameInfo.spriteHeight,
        Math.round(p.x - sz / 2 + offsetX),
        Math.round(p.y - sz / 2 + offsetY),
        sz,
        sz
      );
    }
  }
}

function drawSpeedLines() {
  const speedRatio = (gameState.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START);
  if (speedRatio < 0.05) return;

  const cx = DOM.canvas.width / 2;
  const cy = DOM.canvas.height / 2;
  const lineCount = Math.floor(12 + speedRatio * 30);
  const alpha = 0.3 + speedRatio * 0.6;

  ctx.save();

  for (let i = 0; i < lineCount; i++) {
    const angle = (Math.PI * 2 * i) / lineCount + gameState.tubeRotation * 0.5 + Math.random() * 0.1;

    const startR = CONFIG.TUBE_RADIUS * (0.08 + Math.random() * 0.25);
    const lineLength = (60 + speedRatio * 180) * (0.7 + Math.random() * 0.3);
    const endR = startR + lineLength;

    const x1 = cx + Math.cos(angle) * startR;
    const y1 = cy + Math.sin(angle) * startR * CONFIG.PLAYER_OFFSET;
    const x2 = cx + Math.cos(angle) * endR;
    const y2 = cy + Math.sin(angle) * endR * CONFIG.PLAYER_OFFSET;

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, `rgba(255, 255, 255, 0)`);
    grad.addColorStop(0.3, `rgba(255, 220, 180, ${alpha * 0.5})`);
    grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);

    ctx.strokeStyle = grad;
    ctx.lineWidth = 1 + speedRatio * 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpeedVignette() {
  const speedRatio = (gameState.speed - CONFIG.SPEED_START) / (CONFIG.SPEED_MAX - CONFIG.SPEED_START);
  if (speedRatio < 0.1) return;

  const cx = DOM.canvas.width / 2;
  const cy = DOM.canvas.height / 2;
  const maxR = Math.max(DOM.canvas.width, DOM.canvas.height);
  const alpha = speedRatio * 0.4;

  const grad = ctx.createRadialGradient(cx, cy, CONFIG.TUBE_RADIUS * 0.6, cx, cy, maxR);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(0.4, `rgba(10, 0, 20, ${alpha * 0.3})`);
  grad.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);

  if (speedRatio > 0.4) {
    const glowAlpha = (speedRatio - 0.4) * 0.15;
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, CONFIG.TUBE_RADIUS * 0.3);
    glowGrad.addColorStop(0, `rgba(255, 200, 150, ${glowAlpha})`);
    glowGrad.addColorStop(1, "rgba(255, 200, 150, 0)");
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);
  }
}

function drawBonusText() {
  gameState.bonusTextTimer--;

  if (gameState.bonusTextTimer <= 0) return;

  const alpha = Math.min(1, gameState.bonusTextTimer / 20);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(DOM.canvas.width / 2 - 220, DOM.canvas.height * 0.28 - 30, 440, 60);

  ctx.fillStyle = "#ffe066";
  ctx.font = "bold 26px Orbitron, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(gameState.bonusText, DOM.canvas.width / 2, DOM.canvas.height * 0.28);

  ctx.restore();
}

function updateUI() {
  gameState.uiUpdateFrame++;

  DOM.distanceVal.textContent = Math.floor(gameState.distance);
  DOM.scoreVal.textContent = Math.floor(gameState.score);

  if (gameState.uiUpdateFrame % 5 === 0) {
    DOM.shieldVal.textContent = player.shield ? "✓" : "✗";
    DOM.multiplierVal.textContent = gameState.baseMultiplier > 1
      ? `x${gameState.baseMultiplier} ${gameState.x2Timer.toFixed(1)}s`
      : "x1";
    DOM.speedVal.textContent = (gameState.speed / CONFIG.SPEED_START).toFixed(2) + "x";
  }

  if (gameState.uiUpdateFrame % 10 === 0) {
    DOM.magnetVal.textContent = player.magnetActive
      ? `✓ ${player.magnetTimer.toFixed(1)}s`
      : "OFF";
    DOM.invertVal.textContent = player.invertActive
      ? `INV ${player.invertTimer.toFixed(1)}s`
      : "OK";
    DOM.spinVal.textContent = gameState.spinCooldown > 0
      ? `⏳ ${(gameState.spinCooldown / 60).toFixed(1)}s`
      : "✓";
    DOM.goldVal.textContent = gameState.goldCoins;
    DOM.silverVal.textContent = gameState.silverCoins;
    DOM.coinsCountVal.textContent = coins.length;
  }
}

/* ===== LEADERBOARD ===== */

function showLeaderboardSkeletons() {
  const skeletonHTML = Array(5).fill(`
    <div class="skeleton-row">
      <div class="skeleton-block skeleton-rank"></div>
      <div class="skeleton-block skeleton-wallet"></div>
      <div class="skeleton-block skeleton-score"></div>
    </div>
  `).join('');

  const startList = document.getElementById('startLeaderboardList');
  if (startList) startList.innerHTML = skeletonHTML;

  const gameOverList = document.getElementById('gameOverLeaderboardList');
  if (gameOverList) gameOverList.innerHTML = skeletonHTML;
}

function displayLeaderboard(leaderboard, playerPosition) {
  let html = '';

  if (leaderboard && leaderboard.length > 0) {
    const sorted = leaderboard
      .sort((a, b) => {
        const scoreA = parseInt(a.bestScore) || 0;
        const scoreB = parseInt(b.bestScore) || 0;
        return scoreB - scoreA;
      })
      .slice(0, 10);

    if (sorted.length === 0) {
      html = '<div class="lb-empty">No result</div>';
    } else {
      html = sorted.map((entry, idx) => {
        const score = parseInt(entry.bestScore) || 0;
        const isMe = entry.wallet === userWallet;

        let rankClass = '';
        if (idx === 0) rankClass = 'gold';
        else if (idx === 1) rankClass = 'silver';
        else if (idx === 2) rankClass = 'bronze';

        const rowClass = isMe ? 'lb-row lb-row--me' : 'lb-row';

        return `
          <div class="${rowClass}">
            <span class="lb-rank ${rankClass}">#${idx + 1}</span>
            <span class="lb-wallet">${entry.wallet.slice(0, 6)}...${entry.wallet.slice(-4)}${isMe ? ' 👤' : ''}</span>
            <span class="lb-score">⭐ ${score}</span>
          </div>
        `;
      }).join('');
    }
  } else {
    html = '<div class="lb-empty">No data</div>';
  }

  const startList = document.getElementById('startLeaderboardList');
  if (startList) startList.innerHTML = html;

  const gameOverList = document.getElementById('gameOverLeaderboardList');
  if (gameOverList) gameOverList.innerHTML = html;
}

async function loadAndDisplayLeaderboard() {
  showLeaderboardSkeletons();

  try {
    const url = `${BACKEND_URL}/api/leaderboard/top?wallet=${userWallet || ''}`;

    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      displayLeaderboard(data.leaderboard, data.playerPosition);
    } else {
      displayLeaderboard([], null);
    }
  } catch (e) {
    console.error("❌ Critical error:", e);
    displayLeaderboard([], null);
  }
}

async function saveResultToLeaderboard() {
  if (!isWalletConnected) {
    console.log("⚪ Wallet is not connected");
    return;
  }

  try {
    const timestamp = Date.now();
    const messageToSign = `Save game result\nWallet: ${userWallet}\nScore: ${Math.floor(gameState.score)}\nDistance: ${Math.floor(gameState.distance)}\nTimestamp: ${timestamp}`;

    const signature = await signMessage(messageToSign);

    if (!signature) {
      console.error("❌ Failed to get signature");
      return;
    }

    const data = {
      wallet: userWallet,
      score: Math.floor(gameState.score),
      distance: Math.floor(gameState.distance),
      goldCoins: gameState.goldCoins,
      silverCoins: gameState.silverCoins,
      timestamp: timestamp,
      signature: signature
    };

    const response = await fetch(`${BACKEND_URL}/api/leaderboard/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet": userWallet
      },
      body: JSON.stringify(data)
    });

    if (response.ok) {
      console.log("✅ Result has been saved!");
      showBonusText("✅ In leaderboard!");
      await loadAndDisplayLeaderboard();
      await updateWalletUI();
    } else {
      console.error("❌ Error saving:", response.status);
    }

  } catch (error) {
    console.error("❌ Error sending result:", error);
  }
}

/* ===== GAME LOOP ===== */

async function gameLoop(time) {
  if (!assetManager.isReady()) {
    const progress = assetManager.getProgress();
    ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);

    const bgGrad = ctx.createLinearGradient(0, 0, DOM.canvas.width, DOM.canvas.height);
    bgGrad.addColorStop(0, "#0a0a15");
    bgGrad.addColorStop(1, "#15080f");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);

    ctx.fillStyle = "#c084fc";
    ctx.font = "bold 28px Orbitron, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Ursas Tube", DOM.canvas.width / 2, DOM.canvas.height * 0.38);

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px Orbitron, Arial";
    ctx.textBaseline = "middle";
    ctx.fillText("⏳ Loading...", DOM.canvas.width / 2, DOM.canvas.height * 0.5);

    const barWidth = DOM.canvas.width * 0.35;
    const barHeight = 25;
    const barX = DOM.canvas.width / 2 - barWidth / 2;
    const barY = DOM.canvas.height * 0.55;

    ctx.strokeStyle = "#c084fc";
    ctx.lineWidth = 3;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "#c084fc";
    ctx.fillRect(barX + 3, barY + 3, (barWidth - 6) * (progress / 100), barHeight - 6);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Orbitron, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.floor(progress)}%`, DOM.canvas.width / 2, barY + barHeight / 2);

    requestAnimationFrame(gameLoop);
    return;
  }

  let delta = 0;
  if (gameState.lastTime === 0) {
    gameState.lastTime = time;
    delta = 1 / 60;
  } else {
    delta = (time - gameState.lastTime) / 1000;
    delta = Math.min(delta, 0.016);
    delta = Math.max(delta, 0.001);
  }
  gameState.lastTime = time;

  perfMonitor.updateFPS();

  ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);

  const bgGrad = ctx.createLinearGradient(0, 0, DOM.canvas.width, DOM.canvas.height);
  bgGrad.addColorStop(0, "#0a0a15");
  bgGrad.addColorStop(1, "#15080f");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);

  try {
    drawTube();
    drawTubeDepth();
    drawTubeCenter();
    drawSpeedLines();
    drawObjects();
    drawCoins();
    drawPlayer();
    drawParticles();
    drawSpeedVignette();
  } catch (e) {
    console.error("❌ Draw error:", e);
  }

  if (gameState.running) {
    try {
      update(delta);
      updateParticles();
    } catch (e) {
      console.error("❌ Update error:", e);
      endGame("Error: " + e.message);
      requestAnimationFrame(gameLoop);
      return;
    }
  }

  try {
    drawBonusText();
    updateUI();
  } catch (e) {
    console.error("❌ UI error:", e);
  }

  requestAnimationFrame(gameLoop);
}

/* ===== INITIALIZATION ===== */

async function initGame() {
  console.log("🎮 Game initialization...");
  // === TELEGRAM MINI APP ===
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;

    // Раскрываем на весь экран
    tg.expand();

    // Устанавливаем тему
    tg.setHeaderColor('#05030b');
    tg.setBackgroundColor('#05030b');

    // Готовность
    tg.ready();

    // Данные пользователя (если нужны)
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const tgUser = tg.initDataUnsafe.user;
      console.log("📱 Telegram user:", tgUser.first_name, tgUser.id);
    }

    // Отключаем стандартное закрытие свайпом вниз
    tg.isClosingConfirmationEnabled = true;

    console.log("✅ Telegram Mini App инициализирован");
  }
  try {
    await assetManager.loadAll();
    if (!assetManager.isReady()) throw new Error("AssetManager не готов");
    console.log("✅ All assets loaded!");
  } catch (error) {
    console.error("❌ Error loading assets:", error);
    alert("❌ Game loading error. Please reload the page.");
    return;
  }

  console.log("🔊 Audio initialization...");
  audioManager.init();
  console.log("✅ Audio ready");

  console.log("⚙️ Restoring settings...");
  restoreAudioSettings();
  initAudioToggles(); 

  console.log("📊 Loading leaderboard...");
  try {
    await loadAndDisplayLeaderboard();
    console.log("✅ Leaderboard loaded");
  } catch (error) {
    console.warn("⚠️ Error loading leaderboard:", error);
  }

  // Скрываем STORE если кошелёк не подключен
  if (!isWalletConnected && DOM.storeBtn) {
    DOM.storeBtn.style.display = "none";
  }

  // Меню музыка
  audioManager.playMusic("menu");

  // Resize canvas
  resizeCanvas();

  console.log("▶️ Starting main loop....");
  requestAnimationFrame(gameLoop);

  if (window.ethereum) {
    console.log("🔗 Subscribe to events MetaMask...");
    window.ethereum.on('accountsChanged', (accounts) => {
      console.log("🔄 Account has changed");
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        userWallet = accounts[0];
        isWalletConnected = true;
        updateWalletUI();
      }
    });
    window.ethereum.on('chainChanged', () => {
      console.log("⛓️ Network has changed - rebooting");
      location.reload();
    });
  }

  console.log("✅ Game is fully initialized!");
}

document.addEventListener('DOMContentLoaded', () => {
  console.log("📄 DOM loaded");
  resizeCanvas();
  initGame();
});

window.addEventListener('resize', () => {
  resizeCanvas();
});

setInterval(() => {
  if (isWalletConnected && gameState.running) {
    perfMonitor.measurePing();
  }
}, 5000);

setTimeout(() => {
  if (isWalletConnected) {
    perfMonitor.measurePing();
  }
}, 2000);

/* ===== TUBE TEXTURE ===== */

const tubeTextureCanvas = document.createElement("canvas");
const tubeTexCtx = tubeTextureCanvas.getContext("2d");
tubeTextureCanvas.width = CONFIG.TEX_SIZE;
tubeTextureCanvas.height = CONFIG.TEX_SIZE;

function generateTubeTexture() {
  for (let y = 0; y < CONFIG.TEX_SIZE; y += CONFIG.TEX_PIXEL_SIZE) {
    for (let x = 0; x < CONFIG.TEX_SIZE; x += CONFIG.TEX_PIXEL_SIZE) {
      const r = 140 + Math.random() * 20;
      const g = 60 + Math.random() * 20;
      const b = 70 + Math.random() * 15;
      tubeTexCtx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      tubeTexCtx.fillRect(x, y, CONFIG.TEX_PIXEL_SIZE, CONFIG.TEX_PIXEL_SIZE);

      if (Math.random() < 0.06) {
        tubeTexCtx.fillStyle = "rgb(180,40,60)";
        tubeTexCtx.fillRect(x, y, CONFIG.TEX_PIXEL_SIZE, CONFIG.TEX_PIXEL_SIZE);
      }
    }
  }
}

generateTubeTexture();
</script>
</body>
</html>
