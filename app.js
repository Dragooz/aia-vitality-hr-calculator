// Thresholds from AIA's published table. Ordered high to low so the first
// match is the best tier.
const TIERS = [
  { points: 150, rules: [{ pct: 0.80, mins: 30 }, { pct: 0.70, mins: 60 }, { pct: 0.60, mins: 90 }] },
  { points: 100, rules: [{ pct: 0.80, mins: 20 }, { pct: 0.70, mins: 30 }, { pct: 0.60, mins: 60 }] },
  { points:  50, rules: [{ pct: 0.80, mins: 10 }, { pct: 0.60, mins: 30 }] },
];

const MIN_AGE = 13;
const MAX_AGE = 100;
const IMPLAUSIBLE_BPM = 230;

const ageEl = document.getElementById("age");
const bpmEl = document.getElementById("bpm");
const minsEl = document.getElementById("mins");
const hintEl = document.getElementById("hint");
const pointsEl = document.getElementById("points");
const sayEl = document.getElementById("say");
const ladderEl = document.getElementById("ladder");
const resultEl = document.getElementById("result");

const bpmFor = (age, pct) => Math.round((220 - age) * pct);

function readInt(el, lo, hi) {
  const n = parseInt(el.value, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
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

let lastPoints = null;

function update() {
  const age = readInt(ageEl, MIN_AGE, MAX_AGE);
  const bpm = readInt(bpmEl, 40, IMPLAUSIBLE_BPM);
  const mins = readInt(minsEl, 1, 600);

  if (age === null) {
    hintEl.textContent = `Enter an age between ${MIN_AGE} and ${MAX_AGE}.`;
    hintEl.classList.add("warn");
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
}

[ageEl, bpmEl, minsEl].forEach(el => el.addEventListener("input", update));
update();
