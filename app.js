// ---- Setup ----
const { createClient } = supabase;
let db = null;
const configured =
  window.SUPABASE_CONFIG &&
  window.SUPABASE_CONFIG.url &&
  window.SUPABASE_CONFIG.url !== "YOUR_SUPABASE_PROJECT_URL";

if (configured) {
  db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
}

const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const TODAY = todayStr();

const PLATE_COLORS = ["#c6482e", "#3b7dd8", "#e3b23c", "#4c9a5b"];

let state = {
  exercises: [],
  todaysWorkouts: [], // rows from workouts table for today
  selectedExerciseId: null,
  pendingSets: [], // sets being built for the currently selected exercise before they're saved
  allWorkouts: [], // full history, loaded lazily
};

// ---- Tab navigation ----
document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
    if (btn.dataset.view === "history") renderHistory();
    if (btn.dataset.view === "analytics") renderAnalytics();
  });
});

document.getElementById("today-label").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric",
});

// ---- Data loading ----
async function loadExercises() {
  const { data, error } = await db.from("exercises").select("*").order("name");
  if (error) { console.error(error); return; }
  state.exercises = data;
  renderPlateGrid();
}

async function loadTodaysWorkouts() {
  const { data, error } = await db
    .from("workouts")
    .select("*, exercises(name, color)")
    .eq("session_date", TODAY);
  if (error) { console.error(error); return; }
  state.todaysWorkouts = data;
  renderSessionSummary();
}

async function loadAllWorkouts() {
  const { data, error } = await db
    .from("workouts")
    .select("*, exercises(name, color)")
    .order("session_date", { ascending: false });
  if (error) { console.error(error); return; }
  state.allWorkouts = data;
}

// ---- Rendering: Log view ----
function renderPlateGrid() {
  const grid = document.getElementById("plate-grid");
  grid.innerHTML = "";
  state.exercises.forEach((ex) => {
    const el = document.createElement("div");
    el.className = "plate" + (state.selectedExerciseId === ex.id ? " selected" : "");
    el.style.setProperty("--plate-color", ex.color);
    el.innerHTML = `<div class="plate-dot"></div><div>${escapeHtml(ex.name)}</div>`;
    el.addEventListener("click", () => selectExercise(ex.id));
    grid.appendChild(el);
  });
  const addEl = document.createElement("div");
  addEl.className = "plate add-plate";
  addEl.innerHTML = `<div class="plate-dot">+</div><div>Add exercise</div>`;
  addEl.addEventListener("click", addCustomExercise);
  grid.appendChild(addEl);
}

function selectExercise(id) {
  state.selectedExerciseId = id;
  state.pendingSets = [];
  renderPlateGrid();
  renderSetEntry();
}

async function addCustomExercise() {
  const name = prompt("Exercise name (e.g. Dips):");
  if (!name || !name.trim()) return;
  const color = PLATE_COLORS[state.exercises.length % PLATE_COLORS.length];
  const { data, error } = await db.from("exercises").insert({ name: name.trim(), color }).select().single();
  if (error) { alert("Couldn't add exercise: " + error.message); return; }
  state.exercises.push(data);
  selectExercise(data.id);
}

function renderSetEntry() {
  const wrap = document.getElementById("set-entry-wrap");
  if (!state.selectedExerciseId) { wrap.innerHTML = ""; return; }
  const ex = state.exercises.find((e) => e.id === state.selectedExerciseId);
  wrap.innerHTML = `
    <div class="set-entry" style="--plate-color:${ex.color}">
      <h3>${escapeHtml(ex.name)}</h3>
      <div class="set-chips" id="set-chips"></div>
      <div class="set-entry-row">
        <input type="number" id="reps-input" min="0" placeholder="reps" />
        <button class="primary" id="add-set-btn" style="--plate-color:${ex.color}">Add set</button>
      </div>
      <button class="secondary" id="save-session-btn">Save to today's session</button>
    </div>
  `;
  renderSetChips();
  document.getElementById("add-set-btn").addEventListener("click", () => {
    const input = document.getElementById("reps-input");
    const val = parseInt(input.value, 10);
    if (!Number.isFinite(val) || val < 0) return;
    state.pendingSets.push(val);
    input.value = "";
    renderSetChips();
  });
  document.getElementById("reps-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("add-set-btn").click();
  });
  document.getElementById("save-session-btn").addEventListener("click", saveSession);
}

function renderSetChips() {
  const chips = document.getElementById("set-chips");
  if (!chips) return;
  chips.innerHTML = state.pendingSets
    .map((r, i) => `<span class="set-chip">Set ${i + 1}: ${r}</span>`)
    .join("");
  document.getElementById("save-session-btn").disabled = state.pendingSets.length === 0;
}

async function saveSession() {
  if (!state.pendingSets.length) return;
  const existing = state.todaysWorkouts.find((w) => w.exercise_id === state.selectedExerciseId);
  if (existing) {
    const merged = [...existing.reps_per_set, ...state.pendingSets];
    const { error } = await db.from("workouts").update({ reps_per_set: merged }).eq("id", existing.id);
    if (error) { alert("Save failed: " + error.message); return; }
  } else {
    const { error } = await db.from("workouts").insert({
      session_date: TODAY,
      exercise_id: state.selectedExerciseId,
      reps_per_set: state.pendingSets,
    });
    if (error) { alert("Save failed: " + error.message); return; }
  }
  state.pendingSets = [];
  state.selectedExerciseId = null;
  document.getElementById("set-entry-wrap").innerHTML = "";
  renderPlateGrid();
  await loadTodaysWorkouts();
}

function renderSessionSummary() {
  const el = document.getElementById("session-summary");
  if (!state.todaysWorkouts.length) {
    el.innerHTML = `<div class="empty-state">Nothing logged yet today — pick an exercise above to get started.</div>`;
    return;
  }
  el.innerHTML = state.todaysWorkouts
    .map((w) => `
      <div class="summary-row" style="--dot-color:${w.exercises.color}">
        <div class="summary-dot"></div>
        <div class="summary-name">${escapeHtml(w.exercises.name)}</div>
        <div class="summary-sets">${w.reps_per_set.join(" / ")}</div>
      </div>
    `)
    .join("");
}

// ---- Rendering: History view ----
async function renderHistory() {
  await loadAllWorkouts();
  renderHeatmap();
  renderHistoryList();
}

function renderHeatmap() {
  const el = document.getElementById("heatmap");
  const days = 84; // ~12 weeks
  const byDate = {};
  state.allWorkouts.forEach((w) => {
    byDate[w.session_date] = (byDate[w.session_date] || 0) + w.reps_per_set.length;
  });
  el.innerHTML = "";
  const today = new Date();
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const count = byDate[key] || 0;
    cells.push({ key, count });
  }
  cells.forEach(({ key, count }) => {
    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.title = key + ": " + count + " sets";
    if (count > 0) {
      const intensity = Math.min(1, count / 8);
      cell.style.background = `color-mix(in srgb, var(--green) ${20 + intensity * 80}%, var(--surface))`;
    }
    el.appendChild(cell);
  });
}

function renderHistoryList() {
  const el = document.getElementById("history-list");
  if (!state.allWorkouts.length) {
    el.innerHTML = `<div class="empty-state">No sessions logged yet.</div>`;
    return;
  }
  const grouped = {};
  state.allWorkouts.forEach((w) => {
    grouped[w.session_date] = grouped[w.session_date] || [];
    grouped[w.session_date].push(w);
  });
  const dates = Object.keys(grouped).sort().reverse();
  el.innerHTML = dates
    .map((date, i) => `
      <div class="history-day${i === 0 ? " open" : ""}" data-date="${date}">
        <div class="history-day-header">
          <span class="history-day-date">${date}</span>
          <span class="mono">${grouped[date].length} exercise${grouped[date].length > 1 ? "s" : ""}</span>
        </div>
        <div class="history-day-body">
          ${grouped[date].map((w) => `
            <div class="summary-row" style="--dot-color:${w.exercises.color}">
              <div class="summary-dot"></div>
              <div class="summary-name">${escapeHtml(w.exercises.name)}</div>
              <div class="summary-sets">${w.reps_per_set.join(" / ")}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `)
    .join("");
  el.querySelectorAll(".history-day-header").forEach((header) => {
    header.addEventListener("click", () => header.parentElement.classList.toggle("open"));
  });
}

// ---- Rendering: Analytics view ----
let chartInstance = null;

async function renderAnalytics() {
  if (!state.allWorkouts.length) await loadAllWorkouts();
  renderPersonalBests();
  renderExerciseSelect();
}

function renderPersonalBests() {
  const el = document.getElementById("pb-grid");
  const byExercise = {};
  state.allWorkouts.forEach((w) => {
    const id = w.exercise_id;
    byExercise[id] = byExercise[id] || { name: w.exercises.name, color: w.exercises.color, maxSet: 0, maxVolume: 0 };
    byExercise[id].maxSet = Math.max(byExercise[id].maxSet, ...w.reps_per_set);
    const volume = w.reps_per_set.reduce((a, b) => a + b, 0);
    byExercise[id].maxVolume = Math.max(byExercise[id].maxVolume, volume);
  });
  const entries = Object.values(byExercise);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">Log a few sessions to see your personal bests.</div>`;
    return;
  }
  el.innerHTML = entries
    .map((e) => `
      <div class="pb-card" style="--plate-color:${e.color}">
        <div class="pb-name">${escapeHtml(e.name)}</div>
        <div class="pb-value">${e.maxSet}</div>
        <div class="pb-label">best single set</div>
        <div class="pb-value" style="margin-top:8px">${e.maxVolume}</div>
        <div class="pb-label">best session total</div>
      </div>
    `)
    .join("");
}

function renderExerciseSelect() {
  const select = document.getElementById("exercise-select");
  const ids = [...new Set(state.allWorkouts.map((w) => w.exercise_id))];
  const exercises = ids.map((id) => state.allWorkouts.find((w) => w.exercise_id === id).exercises).filter(Boolean);
  const uniqueByName = [];
  const seen = new Set();
  ids.forEach((id) => {
    const w = state.allWorkouts.find((w) => w.exercise_id === id);
    if (!seen.has(id)) { seen.add(id); uniqueByName.push({ id, name: w.exercises.name, color: w.exercises.color }); }
  });
  if (!uniqueByName.length) {
    document.getElementById("chart-wrap").innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  select.innerHTML = uniqueByName.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  select.onchange = () => renderChart(select.value);
  renderChart(uniqueByName[0].id);
}

function renderChart(exerciseId) {
  const wrap = document.getElementById("chart-wrap");
  wrap.innerHTML = `<canvas id="progress-chart" height="220"></canvas>`;
  const rows = state.allWorkouts
    .filter((w) => w.exercise_id === exerciseId)
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
  const labels = rows.map((r) => r.session_date);
  const totals = rows.map((r) => r.reps_per_set.reduce((a, b) => a + b, 0));
  const color = rows.length ? rows[0].exercises.color : "#3b7dd8";

  if (chartInstance) chartInstance.destroy();
  const ctx = document.getElementById("progress-chart").getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Total reps",
        data: totals,
        borderColor: color,
        backgroundColor: color + "33",
        fill: true,
        tension: 0.25,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8a8f98" }, grid: { color: "rgba(236,233,227,0.06)" } },
        y: { ticks: { color: "#8a8f98" }, grid: { color: "rgba(236,233,227,0.06)" }, beginAtZero: true },
      },
    },
  });
}

// ---- Utilities ----
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init ----
async function init() {
  if (!configured) {
    document.getElementById("setup-banner").style.display = "block";
    return;
  }
  await loadExercises();
  await loadTodaysWorkouts();
}

init();
