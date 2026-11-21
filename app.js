// Thresholds from AIA's published table. Ordered high to low so the first
// match is the best tier. pct is a whole-number percent of max heart rate.
const TIERS = [
  { points: 150, rules: [{ pct: 80, mins: 30 }, { pct: 70, mins: 60 }, { pct: 60, mins: 90 }] },
  { points: 100, rules: [{ pct: 80, mins: 20 }, { pct: 70, mins: 30 }, { pct: 60, mins: 60 }] },
  { points:  50, rules: [{ pct: 80, mins: 10 }, { pct: 60, mins: 30 }] },
];

// One definition per field: bounds, and what to say when they are broken.
// Ranges are chosen from what is physiologically real, not round numbers.
const LIMITS = {
  age: {
    min: 13, max: 100,
    low:  "Age looks too low. Enter 13 or above.",
    high: "Age looks too high. Enter 100 or below.",
    empty: "Enter your age to work out your heart rate targets.",
  },
  bpm: {
    // 230 is above the highest reliably recorded human heart rate; past that
    // it is a sensor fault. Below 40 is not exercise.
    min: 40, max: 230,
    low:  "That is below an exercising heart rate. Check the reading.",
    high: "Above 230 bpm is a sensor fault, not an effort. Wrist sensors often double-count during weights or cycling.",
    empty: "Enter the average heart rate your watch recorded.",
  },
  mins: {
    min: 1, max: 600,
    low:  "Enter at least 1 minute.",
    high: "Over 10 hours is longer than one unbroken session.",
    empty: "Enter how long the workout lasted.",
  },
  steps: {
    min: 0, max: 100000,
    low:  "Steps cannot be negative.",
    high: "Over 100,000 steps in a day is beyond a tracker's plausible range.",
    empty: "Enter your step count.",
  },
};

const MIN_AGE = LIMITS.age.min;
const MAX_AGE = LIMITS.age.max;

// Step thresholds from AIA's points table, high to low.
const STEP_TIERS = [
  { points: 100, min: 12500 },
  { points:  50, min:  7500 },
  { points:  25, min:  5000 },
];

const ageEl = document.getElementById("age");
const bpmEl = document.getElementById("bpm");
const minsEl = document.getElementById("mins");
const hintEl = document.getElementById("hint");
const pointsEl = document.getElementById("points");
const sayEl = document.getElementById("say");
const trackEl = document.getElementById("track");
const resultEl = document.getElementById("result");
const stepsEl = document.getElementById("steps");
const stepsPtsEl = document.getElementById("steps-pts");
const stepsTrackEl = document.getElementById("steps-track");
const nextEl = document.getElementById("next");
const stepsNextEl = document.getElementById("steps-next");
const tabHrPtsEl = document.getElementById("tab-hr-pts");
const tabStepsPtsEl = document.getElementById("tab-steps-pts");
const tabEls = [...document.querySelectorAll(".tab")];

const nf = new Intl.NumberFormat("en-MY");

// AIA always rounds the target UP: at 27, 70% is 135.1, so 135 fails and
// 136 passes. Integer maths first so float noise never tips a whole number up.
const bpmFor = (age, pct) => Math.ceil(((220 - age) * pct) / 100);

/* ---------- remember last inputs ---------- */

const STORE_KEY = "aia-hr-calc:v1";
const FIELDS = [ageEl, bpmEl, minsEl, stepsEl];

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved) return;
    for (const el of FIELDS) {
      if (typeof saved[el.id] === "string") el.value = saved[el.id];
    }
    if (saved.tab === "hr" || saved.tab === "steps") showTab(saved.tab);
  } catch (_) { /* storage blocked or corrupt: keep defaults */ }
}

function save() {
  try {
    const data = {};
    for (const el of FIELDS) data[el.id] = el.value;
    data.tab = activeTab;
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (_) { /* private mode etc. */ }
}

/* ---------- validation ---------- */

// Returns {value} when good, or {error} naming what is wrong. Never both.
function validate(el, key) {
  const lim = LIMITS[key];
  const raw = el.value.trim();

  if (raw === "") return { error: lim.empty, empty: true };
  if (!/^-?\d+$/.test(raw)) return { error: "Enter a whole number." };

  const n = Number(raw);
  if (n < lim.min) return { error: lim.low };
  if (n > lim.max) return { error: lim.high };
  return { value: n };
}

// Mark the input and show the message under it.
function applyState(el, result) {
  const msgEl = document.getElementById(el.id + "-msg");
  const bad = result.error !== undefined && !result.empty;

  el.classList.toggle("invalid", bad);
  el.setAttribute("aria-invalid", bad ? "true" : "false");

  if (msgEl) {
    msgEl.textContent = result.error || "";
    msgEl.classList.toggle("show", result.error !== undefined);
    msgEl.classList.toggle("hard", bad);
  }
  return result.value ?? null;
}

/* ---------- scoring ---------- */

// Which rule inside a tier is closest for this session, and what it needs.
function nearestRule(tier, age, bpm, mins) {
  let best = null;
  for (const r of tier.rules) {
    const target = bpmFor(age, r.pct);
    const needBpm = Math.max(0, target - bpm);
    const needMins = Math.max(0, r.mins - mins);
    // Beats are harder to add than minutes, so weight them heavier.
    const cost = needMins + needBpm * 3;
    if (best === null || cost < best.cost) best = { ...r, target, needBpm, needMins, cost };
  }
  return best;
}

function earned(age, bpm, mins) {
  for (const tier of TIERS) {
    for (const r of tier.rules) {
      if (bpm >= bpmFor(age, r.pct) && mins >= r.mins) return { points: tier.points, rule: r };
    }
  }
  return { points: 0, rule: null };
}

function stepPoints(steps) {
  for (const t of STEP_TIERS) if (steps >= t.min) return t.points;
  return 0;
}

/* ---------- workout timeline ---------- */

// One lane per intensity, each with its own minute milestones.
const LANES = [80, 70, 60].map(pct => ({
  pct,
  marks: TIERS.flatMap(t => t.rules.filter(r => r.pct === pct).map(r => ({ mins: r.mins, points: t.points })))
              .sort((a, b) => a.mins - b.mins),
}));

// Piecewise minute scale: the crowded 0-30 range gets as much room as 30-90,
// so the 10/20/30 milestones on the 80% lane do not collide on a phone.
const X_STOPS = [[0, 0], [30, 45], [90, 90], [120, 100]];
function xPos(mins) {
  const m = Math.max(0, Math.min(mins, 120));
  for (let i = 1; i < X_STOPS.length; i++) {
    const [m0, x0] = X_STOPS[i - 1], [m1, x1] = X_STOPS[i];
    if (m <= m1) return x0 + ((m - m0) / (m1 - m0)) * (x1 - x0);
  }
  return 100;
}

function renderTrack(age, bpm, mins, points) {
  const hasBpm = bpm !== null, hasMins = mins !== null;

  // The single next goal, so the chart can light it up.
  const nextTier = [...TIERS].reverse().find(t => t.points > points);
  const goal = nextTier && hasBpm && hasMins ? nearestRule(nextTier, age, bpm, mins) : null;

  // Minute lanes.
  const lanes = LANES.map(lane => {
    const target = bpmFor(age, lane.pct);
    const ok = hasBpm && bpm >= target;
    const fill = hasMins ? xPos(mins) : 0;

    const marks = lane.marks.map(mk => {
      const got = ok && hasMins && mins >= mk.mins;
      const isGoal = goal && goal.pct === lane.pct && goal.mins === mk.mins;
      const won = got && mk.points === points;
      return `<div class="mk ${got ? "got" : ""} ${isGoal ? "goal" : ""} ${won ? "won" : ""}"
                   style="left:${xPos(mk.mins)}%" title="${mk.points} pts at ${mk.mins} min">${mk.points}</div>`;
    }).join("");

    const chip = ok
      ? `<span class="chip ok">&#10003;</span>`
      : hasBpm ? `<span class="chip">+${target - bpm}</span>` : "";

    return `<div class="lane ${ok ? "ok" : "locked"}">
        <div class="lane-label"><b>${lane.pct}%</b><span>${target}+</span>${chip}</div>
        <div class="lane-bar">
          <div class="lane-fill" style="width:${fill}%"></div>
          ${hasMins ? `<div class="now" style="left:${fill}%"></div>` : ""}
          ${marks}
        </div>
      </div>`;
  }).join("");

  const axis = [0, 10, 20, 30, 60, 90, 120].map(m =>
    `<span style="left:${xPos(m)}%">${m === 120 ? "120+" : m}</span>`).join("");

  let next;
  if (!hasBpm || !hasMins) next = "";
  else if (!goal) next = `<span class="next done">Max tier &#9733;</span>`;
  else {
    const bits = [];
    if (goal.needMins > 0) bits.push(`+${goal.needMins} min`);
    if (goal.needBpm > 0) bits.push(`+${goal.needBpm} bpm`);
    next = `<span class="next">Next <b>${nextTier.points}</b> &rarr; ${bits.join(" · ")}</span>`;
  }

  nextEl.innerHTML = next;
  trackEl.innerHTML = `
    <div class="row-label">Average heart rate</div>
    <div class="lanes">${lanes}</div>
    <div class="axis-wrap"><div class="axis">${axis}</div><div class="axis-title">Minutes &rarr;</div></div>`;
}

/* ---------- steps timeline ---------- */

const STEP_MAX = 15000;
const stepX = s => Math.min(100, (s / STEP_MAX) * 100);

function renderSteps(steps, hrPoints) {
  // hrPoints: used only to mark which tab wins.
  const has = steps !== null;
  const pts = has ? stepPoints(steps) : 0;

  stepsPtsEl.textContent = has ? pts : "—";
  stepsPtsEl.classList.toggle("zero", pts === 0);
  tabStepsPtsEl.textContent = has ? pts : "—";

  const next = has ? [...STEP_TIERS].reverse().find(t => steps < t.min) : null;
  const marks = [...STEP_TIERS].reverse().map(t => {
    const got = has && steps >= t.min;
    const isGoal = next && next.min === t.min;
    const won = got && t.points === pts;
    return `<div class="mk ${got ? "got" : ""} ${isGoal ? "goal" : ""} ${won ? "won" : ""}"
                 style="left:${stepX(t.min)}%" title="${t.points} pts at ${nf.format(t.min)} steps">${t.points}</div>`;
  }).join("");
  const axis = [0, 5000, 7500, 12500, 15000].map(s =>
    `<span style="left:${stepX(s)}%">${s === 0 ? 0 : (s / 1000) + "k"}${s === STEP_MAX ? "+" : ""}</span>`).join("");

  const label = !has ? ""
    : next ? `<span class="next">Next <b>${next.points}</b> &rarr; +${nf.format(next.min - steps)}</span>`
           : `<span class="next done">Max tier &#9733;</span>`;

  stepsNextEl.innerHTML = label;
  stepsTrackEl.innerHTML = `
    <div class="lane ok solo">
      <div class="lane-bar">
        <div class="lane-fill" style="width:${has ? stepX(steps) : 0}%"></div>
        ${has ? `<div class="now" style="left:${stepX(steps)}%"></div>` : ""}
        ${marks}
      </div>
    </div>
    <div class="axis-wrap solo"><div class="axis">${axis}</div><div class="axis-title">Steps &rarr;</div></div>`;

  markWinner(hrPoints, pts);
  return pts;
}

/* ---------- higher score wins ---------- */

// Points never stack, so mark the tab whose score AIA actually pays.
function markWinner(hrPoints, stepPts) {
  const best = Math.max(hrPoints, stepPts);
  tabHrPtsEl.classList.toggle("win", best > 0 && hrPoints === best);
  tabStepsPtsEl.classList.toggle("win", best > 0 && stepPts === best && hrPoints !== best);
}

/* ---------- main ---------- */

let lastPoints = null;

function update() {
  const age = applyState(ageEl, validate(ageEl, "age"));
  const bpm = applyState(bpmEl, validate(bpmEl, "bpm"));
  const mins = applyState(minsEl, validate(minsEl, "mins"));
  const steps = applyState(stepsEl, validate(stepsEl, "steps"));

  if (age === null) {
    hintEl.textContent = "Enter your age to see your heart rate targets.";
    hintEl.classList.add("warn");
    pointsEl.textContent = "—";
    pointsEl.classList.add("zero");
    sayEl.textContent = "";
    resultEl.style.setProperty("--fill", 0);
    trackEl.innerHTML = "";
    nextEl.innerHTML = "";
    tabHrPtsEl.textContent = "—";
    renderSteps(steps, 0);
    return;
  }

  const maxHr = 220 - age;
  hintEl.classList.remove("warn");
  hintEl.innerHTML = `Maximum: <b>${maxHr} bpm</b> (220 minus age). Targets round up.`;

  if (bpm === null || mins === null) {
    pointsEl.textContent = "—";
    pointsEl.classList.add("zero");
    sayEl.textContent = bpm === null
      ? "Enter the average heart rate your watch recorded."
      : "Enter how long the workout lasted.";
    resultEl.style.setProperty("--fill", 0);
    tabHrPtsEl.textContent = "—";
    renderTrack(age, bpm, mins, 0);
    renderSteps(steps, 0);
    return;
  }

  const { points } = earned(age, bpm, mins);
  // Floor so 69.9% never reads as 70%.
  const pctOfMax = Math.floor((bpm / maxHr) * 100);

  if (points !== lastPoints) {
    pointsEl.classList.remove("bump");
    void pointsEl.offsetWidth; // restart the animation
    pointsEl.classList.add("bump");
    lastPoints = points;
  }

  pointsEl.textContent = points;
  tabHrPtsEl.textContent = points;
  pointsEl.classList.toggle("zero", points === 0);
  resultEl.style.setProperty("--fill", points / 150);
  sayEl.innerHTML = `<b>${mins} min</b> · <b>${bpm} bpm</b> · <b>${pctOfMax}%</b> of max`;

  renderTrack(age, bpm, mins, points);
  renderSteps(steps, points);
}

/* ---------- tabs ---------- */

let activeTab = "hr";

function showTab(name) {
  activeTab = name;
  for (const t of tabEls) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
}

tabEls.forEach((t, i) => {
  t.addEventListener("click", () => { showTab(t.dataset.tab); save(); });
  // Arrow keys move between tabs, per the WAI-ARIA tabs pattern.
  t.addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = tabEls[(i + (e.key === "ArrowRight" ? 1 : tabEls.length - 1)) % tabEls.length];
    showTab(n.dataset.tab); n.focus(); save();
  });
});

restore();
FIELDS.forEach(el => el.addEventListener("input", () => { save(); update(); }));
update();
