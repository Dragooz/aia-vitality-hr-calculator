// Thresholds transcribed from AIA's published table. minPct is the fraction of
// age-related max heart rate; minMins is session length. Ordered high to low so
// the first match in checkSession() is the best tier.
const TIERS = [
  { points: 150, rules: [{ minPct: 0.80, minMins: 30 }, { minPct: 0.70, minMins: 60 }, { minPct: 0.60, minMins: 90 }] },
  { points: 100, rules: [{ minPct: 0.80, minMins: 20 }, { minPct: 0.70, minMins: 30 }, { minPct: 0.60, minMins: 60 }] },
  { points:  50, rules: [{ minPct: 0.80, minMins: 10 }, { minPct: 0.60, minMins: 30 }] },
];

// AIA Vitality membership starts at 16. Allow a little below rather than
// rejecting someone checking a family member, but not a child's.
const MIN_AGE = 13;
const MAX_AGE = 100;

// Above this the reading is a sensor fault, not an effort. The highest
// reliably recorded human heart rates sit around 220-230 bpm.
const IMPLAUSIBLE_BPM = 230;

// AIA credits one unbroken session. Longer is usually a day's total.
const LONG_SESSION_MINS = 240;

const ageInput = document.getElementById("age");
const bpmInput = document.getElementById("bpm");
const minsInput = document.getElementById("mins");
const maxhrEl = document.getElementById("maxhr");
const noteEl = document.getElementById("note");
const zonesEl = document.getElementById("zones");
const tiersEl = document.getElementById("tiers");
const verdictPtsEl = document.getElementById("verdict-pts");
const verdictTextEl = document.getElementById("verdict-text");
const zonesWrap = document.getElementById("zones-wrap");
const tableSection = document.getElementById("table-section");
const verdictEl = document.getElementById("verdict");

// Round to the nearest whole beat: a target with a decimal is unusable on a
// watch. This can differ by 1 bpm from AIA's unrounded figure.
const bpmFor = (age, pct) => Math.round((220 - age) * pct);

// Why an age was rejected, so the message names which end it failed.
function ageProblem(raw) {
  if (raw.trim() === "") return "Enter your age to see your targets.";
  const age = Number(raw);
  if (!Number.isFinite(age) || !Number.isInteger(age)) return "Enter your age as a whole number.";
  if (age < MIN_AGE) return `Enter an age of ${MIN_AGE} or above.`;
  if (age > MAX_AGE) return `Enter an age of ${MAX_AGE} or below.`;
  return null;
}

function renderZones(age) {
  zonesEl.innerHTML = [0.60, 0.70, 0.80].map(pct => `
    <div class="zone">
      <span class="zone-pct">${Math.round(pct * 100)}%</span>
      <span class="zone-bpm">${bpmFor(age, pct)}</span>
    </div>`).join("");
}

function renderTiers(age, didBpm, didMins) {
  const rows = [];
  for (const tier of TIERS) {
    tier.rules.forEach((rule, i) => {
      const targetBpm = bpmFor(age, rule.minPct);
      const hit = didBpm !== null && didMins !== null && didBpm >= targetBpm && didMins >= rule.minMins;
      rows.push(`
        <tr class="${i === 0 ? "tier-start" : ""}${hit ? " hit" : ""}">
          <td class="bpm"><b>${targetBpm} bpm</b> &middot; ${Math.round(rule.minPct * 100)}%</td>
          <td class="dur">${rule.minMins} min</td>
          ${i === 0 ? `<td class="pts" rowspan="${tier.rules.length}">${tier.points}</td>` : ""}
        </tr>`);
    });
  }
  tiersEl.innerHTML = rows.join("");
}

function checkSession(age, didBpm, didMins) {
  for (const tier of TIERS) {
    for (const rule of tier.rules) {
      if (didBpm >= bpmFor(age, rule.minPct) && didMins >= rule.minMins) {
        return { points: tier.points, rule };
      }
    }
  }
  return { points: 0, rule: null };
}

// The nearest tier the session missed, and what would close the gap.
function shortfallAdvice(age, didBpm, didMins, earnedPoints) {
  let best = null;
  for (const tier of TIERS) {
    if (tier.points <= earnedPoints) continue;
    for (const rule of tier.rules) {
      const targetBpm = bpmFor(age, rule.minPct);
      const extraMins = Math.max(0, rule.minMins - didMins);
      const extraBpm = Math.max(0, targetBpm - didBpm);
      // Minutes are the easier gap to close, so weight beats heavier rather
      // than comparing the raw numbers.
      const cost = extraMins + extraBpm * 3;
      if (best === null || cost < best.cost) {
        best = { cost, extraMins, extraBpm, targetBpm, rule, points: tier.points };
      }
    }
  }
  if (best === null) return "";
  const needs = [];
  if (best.extraBpm > 0) needs.push(`<b>${best.extraBpm} bpm</b> harder`);
  if (best.extraMins > 0) needs.push(`<b>${best.extraMins} min</b> longer`);
  return ` For ${best.points}: ${needs.join(" and ")}.`;
}

function update() {
  const problem = ageProblem(ageInput.value);

  if (problem !== null) {
    maxhrEl.textContent = "—";
    noteEl.textContent = problem;
    noteEl.classList.add("warn");
    zonesWrap.hidden = true;
    tableSection.hidden = true;
    verdictEl.hidden = true;
    return;
  }

  const age = Number(ageInput.value);
  const maxHr = 220 - age;

  noteEl.classList.remove("warn");
  noteEl.innerHTML = `220 &minus; ${age} = ${maxHr} bpm`;
  zonesWrap.hidden = false;
  tableSection.hidden = false;
  verdictEl.hidden = false;

  maxhrEl.textContent = maxHr;
  renderZones(age);

  const didBpm = parseInt(bpmInput.value, 10);
  const didMins = parseInt(minsInput.value, 10);
  const entered = Number.isFinite(didBpm) && didBpm > 0 && Number.isFinite(didMins) && didMins > 0;

  renderTiers(age, entered ? didBpm : null, entered ? didMins : null);

  if (!entered) {
    verdictPtsEl.textContent = "—";
    verdictPtsEl.classList.add("zero");
    verdictTextEl.textContent = "Enter a heart rate and a length to check a session.";
    return;
  }

  // A reading far above the age-related maximum is almost always the watch
  // misreading, not a real effort. Say so rather than awarding points on it.
  if (didBpm > IMPLAUSIBLE_BPM) {
    verdictPtsEl.textContent = "—";
    verdictPtsEl.classList.add("zero");
    verdictTextEl.innerHTML = `<b>${didBpm} bpm</b> is above what a human heart sustains. Check the reading &mdash; wrist sensors often double-count during weights or cycling.`;
    return;
  }

  const { points, rule } = checkSession(age, didBpm, didMins);
  verdictPtsEl.textContent = points;
  verdictPtsEl.classList.toggle("zero", points === 0);

  const pctOfMax = Math.round((didBpm / maxHr) * 100);
  const parts = [`<b>${didMins} min</b> at <b>${didBpm} bpm</b> is ${pctOfMax}% of your max.`];

  // Over 100% is possible (the formula is an average, not a ceiling) but more
  // often a bad reading, so flag it either way.
  if (didBpm > maxHr) parts.push(`That is above your ${maxHr} bpm age-related max.`);
  if (points > 0) parts.push(`Clears ${rule.minMins} min at ${Math.round(rule.minPct * 100)}%.`);
  else parts.push("Under every threshold.");

  const advice = shortfallAdvice(age, didBpm, didMins, points);
  if (advice) parts.push(advice.trim());
  if (didMins > LONG_SESSION_MINS) parts.push("That is unusually long for one unbroken session.");

  verdictTextEl.innerHTML = parts.join(" ");
}

[ageInput, bpmInput, minsInput].forEach(el => el.addEventListener("input", update));
update();
