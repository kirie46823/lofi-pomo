import "./style.css";

const $ = (id) => document.getElementById(id);

const els = {
  mode: $("mode"),
  time: $("time"),
  startPause: $("startPause"),
  skip: $("skip"),
  reset: $("reset"),
  count: $("count"),

  bgmOn: $("bgmOn"),
  bgmVol: $("bgmVol"),
  rainOn: $("rainOn"),
  rainVol: $("rainVol"),

  workMin: $("workMin"),
  breakMin: $("breakMin"),
  longMin: $("longMin"),
  longEvery: $("longEvery"),
  save: $("save"),
  status: $("status"),
};

const STORAGE_KEY = "lofi-pomo:v1";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultState() {
  return {
    workMin: 25,
    breakMin: 5,
    longMin: 15,
    longEvery: 4,
    bgmOn: true,
    bgmVol: 0.45,
    rainOn: false,
    rainVol: 0.25,
    pomosByDay: { [todayKey()]: 0 },
  };
}

function mergeState(base, patch) {
  return {
    ...base,
    ...patch,
    pomosByDay: { ...(base.pomosByDay || {}), ...(patch.pomosByDay || {}) },
  };
}

// --- Audio (HTMLAudio keeps it simple and light) ---
const audio = {
  bgm: new Audio("/audio/111.mp3"),
  ready: false,
};

function setupAudio() {
  const a = audio.bgm;
  a.loop = true;
  a.preload = "auto";
  a.playsInline = true; // iOS対策
  a.crossOrigin = "anonymous";
  audio.ready = true;
}

async function playIfEnabled(state) {
  if (!audio.ready) setupAudio();

  audio.bgm.volume = clamp01(state.bgmVol);

  if (state.bgmOn) {
    try { await audio.bgm.play(); } catch {}
  } else {
    audio.bgm.pause();
  }
}

function pauseAll() {
  audio.bgm.pause();
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// --- Pomodoro ---
const MODE = { WORK: "WORK", BREAK: "BREAK", LONG: "LONG" };

let state = mergeState(defaultState(), loadSettings() || {});
let mode = MODE.WORK;
let remainingSec = state.workMin * 60;
let running = false;
let timerId = null;
let completedWorkSessions = 0;

function getTodayCount() {
  const k = todayKey();
  return state.pomosByDay?.[k] ?? 0;
}

function incTodayCount() {
  const k = todayKey();
  const cur = state.pomosByDay?.[k] ?? 0;
  state.pomosByDay[k] = cur + 1;
  saveSettings(state);
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function render() {
  els.mode.textContent = mode;
  els.time.textContent = fmt(remainingSec);
  els.startPause.textContent = running ? "Pause" : "Start";
  els.count.textContent = String(getTodayCount());

  els.bgmOn.checked = !!state.bgmOn;
  els.rainOn.checked = !!state.rainOn;
  els.bgmVol.value = String(Math.round(clamp01(state.bgmVol) * 100));
  els.rainVol.value = String(Math.round(clamp01(state.rainVol) * 100));

  els.workMin.value = String(state.workMin);
  els.breakMin.value = String(state.breakMin);
  els.longMin.value = String(state.longMin);
  els.longEvery.value = String(state.longEvery);
}

function setMode(newMode) {
  mode = newMode;
  if (mode === MODE.WORK) remainingSec = state.workMin * 60;
  if (mode === MODE.BREAK) remainingSec = state.breakMin * 60;
  if (mode === MODE.LONG) remainingSec = state.longMin * 60;
  render();
}

function tick() {
  if (!running) return;
  remainingSec -= 1;
  if (remainingSec <= 0) {
    remainingSec = 0;
    onFinish();
    return;
  }
  render();
}

function startTimer() {
  if (running) return;
  running = true;
  timerId = setInterval(tick, 1000);
  render();
}

function stopTimer() {
  running = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  render();
}

function resetTimer() {
  stopTimer();
  setMode(mode); // reset current mode duration
}

function onFinish() {
  stopTimer();

  // Simple beep (offline, no file): WebAudio
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.03;
    o.connect(g).connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 180);
  } catch {}

  if (mode === MODE.WORK) {
    incTodayCount();
    completedWorkSessions += 1;

    const longEvery = Math.max(2, Number(state.longEvery) || 4);
    if (completedWorkSessions % longEvery === 0) {
      setMode(MODE.LONG);
    } else {
      setMode(MODE.BREAK);
    }
  } else {
    setMode(MODE.WORK);
  }
}

// --- UI events ---
els.startPause.addEventListener("click", async () => {
  // iOS 対策：Start押下内で audio.play() を呼ぶ
  await playIfEnabled(state);

  if (running) {
    stopTimer();
    // BGMは流し続ける設計でもOK。止めたいなら pauseAll() に切替。
  } else {
    startTimer();
  }
});

els.skip.addEventListener("click", () => {
  onFinish();
});

els.reset.addEventListener("click", () => {
  resetTimer();
});

els.bgmOn.addEventListener("change", async () => {
  state.bgmOn = els.bgmOn.checked;
  saveSettings(state);
  await playIfEnabled(state);
  render();
});

els.rainOn.addEventListener("change", async () => {
  state.rainOn = els.rainOn.checked;
  saveSettings(state);
  await playIfEnabled(state);
  render();
});

els.bgmVol.addEventListener("input", async () => {
  state.bgmVol = Number(els.bgmVol.value) / 100;
  saveSettings(state);
  if (audio.ready) audio.bgm.volume = clamp01(state.bgmVol);
  render();
});

els.rainVol.addEventListener("input", async () => {
  state.rainVol = Number(els.rainVol.value) / 100;
  saveSettings(state);
  if (audio.ready) audio.rain.volume = clamp01(state.rainVol);
  render();
});

els.save.addEventListener("click", () => {
  const next = {
    ...state,
    workMin: Math.max(1, Number(els.workMin.value) || 25),
    breakMin: Math.max(1, Number(els.breakMin.value) || 5),
    longMin: Math.max(1, Number(els.longMin.value) || 15),
    longEvery: Math.max(2, Number(els.longEvery.value) || 4),
  };
  state = next;
  saveSettings(state);

  // 反映：今のモードだけ即反映（走ってる時は残りを維持）
  if (!running) setMode(mode);

  els.status.textContent = "Saved.";
  setTimeout(() => (els.status.textContent = ""), 1200);
  render();
});

// Stop audio when tab hidden (optional)
document.addEventListener("visibilitychange", () => {
  // 通信量には関係ない。電池節約。好みで。
  if (document.hidden) pauseAll();
});

// --- SW register ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch {}
  });
}

// init
saveSettings(state); // ensure defaults exist
setMode(MODE.WORK);
render();
