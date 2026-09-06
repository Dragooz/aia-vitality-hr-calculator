// Thresholds from AIA's published table. Ordered high to low so the first
// match is the best tier.
const TIERS = [
  { points: 150, rules: [{ pct: 0.80, mins: 30 }, { pct: 0.70, mins: 60 }, { pct: 0.60, mins: 90 }] },
  { points: 100, rules: [{ pct: 0.80, mins: 20 }, { pct: 0.70, mins: 30 }, { pct: 0.60, mins: 60 }] },
  { points:  50, rules: [{ pct: 0.80, mins: 10 }, { pct: 0.60, mins: 30 }] },
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
const ladderEl = document.getElementById("ladder");
const resultEl = document.getElementById("result");
const stepsEl = document.getElementById("steps");
const stepsPtsEl = document.getElementById("steps-pts");
const stepsNoteEl = document.getElementById("steps-note");
const totalEl = document.getElementById("total");

const bpmFor = (age, pct) => Math.round((220 - age) * pct);

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

function renderLadder(age, bpm, mins, points) {
  // Low to high reads as a climb.
  const rows = [...TIERS].reverse().map(tier => {
    const done = points >= tier.points;
    const near = nearestRule(tier, age, bpm, mins);
    const isNext = !done && tier.points > points &&
                   !TIERS.some(t => t.points > points && t.points < tier.points);

    let how, tick;
    if (done) {
      how = `<b>${near.mins} min</b> at <b>${near.target} bpm</b>`;
      tick = "Earned";
    } else {
      const gaps = [];
      if (near.needBpm > 0) gaps.push(`<b>${near.needBpm} bpm</b> harder`);
      if (near.needMins > 0) gaps.push(`<b>${near.needMins} min</b> longer`);
      how = gaps.join(" and ");
      tick = isNext ? "Next up" : "";
    }

    return `<div class="rung ${done ? "done" : ""} ${isNext ? "next" : ""}">
      <div class="rung-pts">${tier.points}</div>
      <div class="rung-how">${how}</div>
      <div class="rung-tick">${tick}</div>
    </div>`;
  });
  ladderEl.innerHTML = rows.join("");
}

const nf = new Intl.NumberFormat("en-MY");

function stepPoints(steps) {
  for (const t of STEP_TIERS) if (steps >= t.min) return t.points;
  return 0;
}

function renderSteps(steps, hrPoints) {
  if (steps === null) {
    stepsPtsEl.textContent = "—";
    stepsPtsEl.classList.add("zero");
    stepsNoteEl.textContent = "Enter your step count.";
    totalEl.innerHTML = "";
    return 0;
  }

  const pts = stepPoints(steps);
  stepsPtsEl.textContent = pts;
  stepsPtsEl.classList.toggle("zero", pts === 0);

  const next = [...STEP_TIERS].reverse().find(t => steps < t.min);
  stepsNoteEl.innerHTML = next
    ? `points &nbsp;·&nbsp; <b>${nf.format(next.min - steps)}</b> more for ${next.points}`
    : "points &nbsp;·&nbsp; top step tier";

  renderTotal(hrPoints, pts);
  return pts;
}

function renderTotal(hrPoints, stepPts) {
  // Heart rate and step points do NOT stack. AIA pays the higher of the two.
  const awarded = Math.max(hrPoints, stepPts);
  const naive = hrPoints + stepPts;
  const bothEarned = hrPoints > 0 && stepPts > 0;

  const source = hrPoints > stepPts ? "your workout"
               : stepPts > hrPoints ? "your steps"
               : "either one on its own";

  // Only worth showing the crossed-out sum when both actually scored - that
  // is the only case where someone would expect them to add up.
  const tally = bothEarned
    ? `<div class="tally">
         <span class="tally-part">${hrPoints}<i>workout</i></span>
         <span class="tally-op">+</span>
         <span class="tally-part">${stepPts}<i>steps</i></span>
         <span class="tally-op">=</span>
         <span class="tally-wrong">${naive}</span>
         <span class="tally-arrow">&rarr;</span>
         <span class="tally-right">${awarded}</span>
       </div>`
    : "";

  const lesson = bothEarned
    ? `<p class="total-lesson"><b>They do not add up.</b> AIA pays the higher of the two, so today is <b>${awarded}</b>, not ${naive}. You earned it from ${source}.</p>`
    : awarded > 0
      ? `<p class="total-lesson">Earned from ${source}. Heart rate and steps never add together &mdash; AIA pays whichever is higher.</p>`
      : `<p class="total-lesson">Nothing yet today. You need 5,000 steps, or a workout that reaches the first heart rate tier.</p>`;

  totalEl.innerHTML = `
    <div class="total-head">
      <span class="total-label">Today you earn</span>
      <span class="total-value ${awarded === 0 ? "zero" : ""}">${awarded}</span>
      <span class="total-unit">of 150 max</span>
    </div>
    ${tally}
    ${lesson}`;
}

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
    ladderEl.innerHTML = "";
    renderSteps(steps, 0);
    return;
  }

  const maxHr = 220 - age;
  hintEl.classList.remove("warn");
  hintEl.innerHTML = `Your max is <b>${maxHr} bpm</b> &nbsp;·&nbsp; 60% is <b>${bpmFor(age, .6)}</b> &nbsp;·&nbsp; 70% is <b>${bpmFor(age, .7)}</b> &nbsp;·&nbsp; 80% is <b>${bpmFor(age, .8)}</b>`;

  if (bpm === null || mins === null) {
    pointsEl.textContent = "—";
    pointsEl.classList.add("zero");
    sayEl.textContent = bpm === null
      ? "Enter the average heart rate your watch recorded."
      : "Enter how long the workout lasted.";
    resultEl.style.setProperty("--fill", 0);
    renderLadder(age, bpm ?? 0, mins ?? 0, 0);
    renderSteps(steps, 0);
    return;
  }

  const { points, rule } = earned(age, bpm, mins);
  const pctOfMax = Math.round((bpm / maxHr) * 100);

  if (points !== lastPoints) {
    pointsEl.classList.remove("bump");
    void pointsEl.offsetWidth; // restart the animation
    pointsEl.classList.add("bump");
    lastPoints = points;
  }

  pointsEl.textContent = points;
  pointsEl.classList.toggle("zero", points === 0);
  resultEl.style.setProperty("--fill", points / 150);

  const effort = `<b>${mins} min</b> at <b>${bpm} bpm</b> is <b>${pctOfMax}%</b> of your max.`;
  if (points === 0) {
    sayEl.innerHTML = `${effort} Just short of the first tier.`;
  } else if (points === 150) {
    sayEl.innerHTML = `${effort} That is the top tier for one workout.`;
  } else {
    sayEl.innerHTML = `${effort} Clears ${rule.mins} min at ${Math.round(rule.pct * 100)}%.`;
  }

  renderLadder(age, bpm, mins, points);
  renderSteps(steps, points);
}

[ageEl, bpmEl, minsEl, stepsEl].forEach(el => el.addEventListener("input", update));
update();
