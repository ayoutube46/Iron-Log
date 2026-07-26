// ============================================================
// Setup
// ============================================================
const { createClient } = supabase;
let db = null;
const configured =
  window.SUPABASE_CONFIG &&
  window.SUPABASE_CONFIG.url &&
  window.SUPABASE_CONFIG.url !== "YOUR_SUPABASE_PROJECT_URL";

if (configured) {
  db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMAIL_DOMAIN = "users.ironlog.local";
const PLATE_COLORS = ["#e2492e", "#3f86e0", "#eab838", "#4fae63"];

const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const TODAY = todayStr();

let state = {
  user: null,
  username: null,
  exercises: [],       // active (non-archived) exercises for the picker
  allExercisesRaw: [],  // every exercise incl. archived, for the manage modal
  todaysWorkouts: [],
  selectedExerciseId: null,
  pendingSets: [],
  allWorkouts: [],
  historyLoaded: false,
  chartMetric: "total",
  chartRange: "30",
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function usernameToEmail(username) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return clean + "@" + EMAIL_DOMAIN;
}

// ============================================================
// Auth screen wiring
// ============================================================
let authMode = "login";
const authTitle = document.getElementById("auth-submit");
const authHint = document.getElementById("auth-hint");
const authError = document.getElementById("auth-error");

document.getElementById("tab-login").addEventListener("click", () => setAuthMode("login"));
document.getElementById("tab-signup").addEventListener("click", () => setAuthMode("signup"));

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById("tab-login").classList.toggle("active", mode === "login");
  document.getElementById("tab-signup").classList.toggle("active", mode === "signup");
  authTitle.textContent = mode === "login" ? "Log in" : "Create account";
  authHint.textContent = mode === "login"
    ? "No account yet? Switch to Sign up above."
    : "Already have an account? Switch to Log in above.";
  hideAuthError();
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.add("visible");
}
function hideAuthError() {
  authError.classList.remove("visible");
}

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!username || !password) return;
  authTitle.disabled = true;
  try {
    if (authMode === "signup") {
      await handleSignup(username, password);
    } else {
      await handleLogin(username, password);
    }
  } finally {
    authTitle.disabled = false;
  }
});

async function handleSignup(username, password) {
  const { data: existing } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) {
    showAuthError("That username is already taken — try another, or log in instead.");
    return;
  }
  const email = usernameToEmail(username);
  const { data, error } = await db.auth.signUp({ email, password });
  if (error) {
    if (error.message.toLowerCase().includes("rate limit")) {
      showAuthError("Too many signups too quickly — Supabase's free email limit was hit. Wait about an hour and try again, or ask the site owner to add a free custom SMTP provider (see README).");
    } else {
      showAuthError(error.message.includes("Password") ? error.message : "Couldn't create that account. " + error.message);
    }
    return;
  }
  if (!data.user) {
    showAuthError("Something went wrong creating your account. Please try again.");
    return;
  }
  const { error: profileError } = await db.from("profiles").insert({ id: data.user.id, username });
  if (profileError) {
    showAuthError("That username was just taken by someone else — please log in or try a different username.");
    return;
  }
  // onAuthStateChange picks up the new session and shows the app.
}

async function handleLogin(username, password) {
  const email = usernameToEmail(username);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthError("Incorrect username or password.");
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
});

// ============================================================
// Auth state -> show app or auth screen
// ============================================================
async function onSignedIn(user) {
  state.user = user;
  const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
  state.username = profile ? profile.username : user.email.split("@")[0];
  document.getElementById("username-pill").textContent = "@" + state.username;
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("app").hidden = false;
  await loadExercises();
  await loadTodaysWorkouts();
  positionTabUnderline();
}

function onSignedOut() {
  state = { ...state, user: null, username: null, exercises: [], allWorkouts: [], todaysWorkouts: [] };
  document.getElementById("app").hidden = true;
  document.getElementById("auth-screen").style.display = "flex";
}

if (configured) {
  db.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) onSignedIn(session.user);
    else onSignedOut();
  });
  db.auth.getSession().then(({ data }) => {
    if (!data.session) onSignedOut();
  });
} else {
  document.getElementById("auth-screen").innerHTML = `
    <div class="auth-card">
      <h1>IRON LOG</h1>
      <div class="setup-banner" style="margin-top:12px">
        <strong>One-time setup needed.</strong> Paste your Supabase URL and anon key into
        <code>config.js</code>, then run <code>supabase-schema.sql</code> in the Supabase SQL
        editor. See <code>README.md</code> for the full walkthrough.
      </div>
    </div>`;
}

document.getElementById("today-label").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric",
});

// ============================================================
// Tab navigation (with animated underline + crossfade)
// ============================================================
document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    positionTabUnderline();
    switchView(btn.dataset.view);
  });
});

function positionTabUnderline() {
  const active = document.querySelector("nav.tabs button.active");
  const underline = document.getElementById("tab-underline");
  if (!active || !underline) return;
  underline.style.left = active.offsetLeft + "px";
  underline.style.width = active.offsetWidth + "px";
}
window.addEventListener("resize", positionTabUnderline);

function switchView(name) {
  const target = document.getElementById("view-" + name);
  document.querySelectorAll(".view").forEach((v) => {
    if (v !== target) v.classList.remove("active");
  });
  target.classList.add("active");
  if (!reduceMotion && window.gsap) {
    gsap.fromTo(target, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
  }
  if (name === "history") renderHistory();
  if (name === "analytics") renderAnalytics();
}

// ============================================================
// Data loading
// ============================================================
async function loadExercises() {
  const { data, error } = await db.from("exercises").select("*").eq("user_id", state.user.id).order("name");
  if (error) { console.error(error); return; }
  state.allExercisesRaw = data;
  state.exercises = data.filter((e) => !e.archived);
  renderPlateGrid();
}

async function loadTodaysWorkouts() {
  const { data, error } = await db
    .from("workouts")
    .select("*, exercises(name, color)")
    .eq("user_id", state.user.id)
    .eq("session_date", TODAY);
  if (error) { console.error(error); return; }
  state.todaysWorkouts = data;
  renderSessionSummary();
}

async function loadAllWorkouts() {
  const { data, error } = await db
    .from("workouts")
    .select("*, exercises(name, color, archived)")
    .eq("user_id", state.user.id)
    .order("session_date", { ascending: false });
  if (error) { console.error(error); return; }
  state.allWorkouts = data;
  state.historyLoaded = true;
}

// ============================================================
// Rendering: Log view
// ============================================================
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

  if (!reduceMotion && window.gsap) {
    gsap.from(grid.children, { opacity: 0, y: 12, duration: 0.35, stagger: 0.03, ease: "power2.out" });
  }
}

function selectExercise(id) {
  state.selectedExerciseId = id;
  state.pendingSets = [];
  timerState = null;
  renderPlateGrid();
  renderSetEntry();
}

async function addCustomExercise() {
  const name = prompt("Exercise name (e.g. Dips):");
  if (!name || !name.trim()) return;
  const color = PLATE_COLORS[state.allExercisesRaw.length % PLATE_COLORS.length];
  const { data, error } = await db.from("exercises").insert({ name: name.trim(), color, user_id: state.user.id }).select().single();
  if (error) { alert("Couldn't add exercise: " + error.message); return; }
  state.allExercisesRaw.push(data);
  state.exercises.push(data);
  selectExercise(data.id);
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function renderSetEntry() {
  const wrap = document.getElementById("set-entry-wrap");
  if (!state.selectedExerciseId) { wrap.innerHTML = ""; return; }
  const ex = state.exercises.find((e) => e.id === state.selectedExerciseId);
  wrap.innerHTML = `
    <div class="set-entry" style="--plate-color:${ex.color}">
      <h3>${escapeHtml(ex.name)}</h3>
      <div class="set-chips" id="set-chips"></div>
      <div id="stopwatch-area"></div>
      <button class="secondary" id="save-session-btn">Save to today's session</button>
    </div>
  `;
  if (!reduceMotion && window.gsap) {
    gsap.from(wrap.firstElementChild, { opacity: 0, y: 8, duration: 0.3, ease: "power2.out" });
  }
  renderSetChips();
  renderStopwatchArea(ex);
  document.getElementById("save-session-btn").addEventListener("click", saveSession);
}

// ---- Live per-set stopwatch ----
let timerState = null; // { startedAt } while a set is in progress

function renderStopwatchArea(ex) {
  const area = document.getElementById("stopwatch-area");
  if (!area) return;
  if (!timerState) {
    area.innerHTML = `
      <div class="set-entry-row">
        <button class="primary" id="start-set-btn" style="--plate-color:${ex.color}">
          Start set ${state.pendingSets.length + 1}
        </button>
      </div>
    `;
    document.getElementById("start-set-btn").addEventListener("click", startSet);
    return;
  }
  area.innerHTML = `
    <div class="stopwatch-live" style="--plate-color:${ex.color}">
      <div class="stopwatch-time mono" id="stopwatch-readout">0:00</div>
      <button class="primary" id="finish-set-btn" style="--plate-color:${ex.color}">Finish set</button>
    </div>
  `;
  document.getElementById("finish-set-btn").addEventListener("click", finishSet);
  tickStopwatch();
}

function startSet() {
  timerState = { startedAt: Date.now() };
  renderStopwatchArea(state.exercises.find((e) => e.id === state.selectedExerciseId));
}

function tickStopwatch() {
  const readout = document.getElementById("stopwatch-readout");
  if (!readout || !timerState) return;
  const elapsed = Math.floor((Date.now() - timerState.startedAt) / 1000);
  readout.textContent = formatDuration(elapsed);
  if (timerState) requestAnimationFrame(() => setTimeout(tickStopwatch, 250));
}

function finishSet() {
  if (!timerState) return;
  const duration = Math.max(1, Math.round((Date.now() - timerState.startedAt) / 1000));
  timerState = null;
  const reps = prompt("How many reps did you complete in that set?");
  const val = parseInt(reps, 10);
  if (!Number.isFinite(val) || val < 0) {
    // Cancelled or invalid — discard this set's timing and let them try again.
    renderStopwatchArea(state.exercises.find((e) => e.id === state.selectedExerciseId));
    return;
  }
  state.pendingSets.push({ reps: val, duration });
  renderSetChips();
  renderStopwatchArea(state.exercises.find((e) => e.id === state.selectedExerciseId));
}

function renderSetChips() {
  const chips = document.getElementById("set-chips");
  if (!chips) return;
  chips.innerHTML = state.pendingSets
    .map((s, i) => `<span class="set-chip">Set ${i + 1}: ${s.reps} reps · ${formatDuration(s.duration)}</span>`)
    .join("");
  const saveBtn = document.getElementById("save-session-btn");
  if (saveBtn) saveBtn.disabled = state.pendingSets.length === 0;
  if (!reduceMotion && window.gsap && chips.lastElementChild) {
    gsap.from(chips.lastElementChild, { scale: 0.5, opacity: 0, duration: 0.25, ease: "back.out(2)" });
  }
}

async function saveSession() {
  if (!state.pendingSets.length) return;
  const exerciseId = state.selectedExerciseId;
  const pendingReps = state.pendingSets.map((s) => s.reps);
  const pendingDurations = state.pendingSets.map((s) => s.duration);

  // Check for a PR against everything logged before today.
  const { data: priorRows } = await db
    .from("workouts")
    .select("reps_per_set")
    .eq("user_id", state.user.id)
    .eq("exercise_id", exerciseId)
    .lt("session_date", TODAY);
  let prevMaxSet = 0;
  (priorRows || []).forEach((r) => { prevMaxSet = Math.max(prevMaxSet, ...r.reps_per_set); });

  const existing = state.todaysWorkouts.find((w) => w.exercise_id === exerciseId);
  const mergedReps = existing ? [...existing.reps_per_set, ...pendingReps] : [...pendingReps];
  const mergedDurations = existing
    ? [...(existing.set_durations || existing.reps_per_set.map(() => null)), ...pendingDurations]
    : [...pendingDurations];

  if (existing) {
    const { error } = await db.from("workouts").update({ reps_per_set: mergedReps, set_durations: mergedDurations }).eq("id", existing.id);
    if (error) { alert("Save failed: " + error.message); return; }
  } else {
    const { error } = await db.from("workouts").insert({
      session_date: TODAY,
      exercise_id: exerciseId,
      reps_per_set: mergedReps,
      set_durations: mergedDurations,
      user_id: state.user.id,
    });
    if (error) { alert("Save failed: " + error.message); return; }
  }

  const newMaxSet = Math.max(...mergedReps);
  const isPR = newMaxSet > prevMaxSet;

  state.pendingSets = [];
  state.selectedExerciseId = null;
  timerState = null;
  document.getElementById("set-entry-wrap").innerHTML = "";
  renderPlateGrid();
  await loadTodaysWorkouts();

  if (isPR) celebratePR(exerciseId);
}

function formatSetsWithTime(reps_per_set, set_durations) {
  return reps_per_set
    .map((r, i) => {
      const d = set_durations && set_durations[i];
      return d ? `${r} reps · ${formatDuration(d)}` : `${r} reps`;
    })
    .join(" / ");
}

function renderSessionSummary() {
  const el = document.getElementById("session-summary");
  if (!state.todaysWorkouts.length) {
    el.innerHTML = `<div class="empty-state">Nothing logged yet today — pick an exercise above to get started.</div>`;
    return;
  }
  el.innerHTML = state.todaysWorkouts
    .map((w) => `
      <div class="summary-row" style="--dot-color:${w.exercises.color}" data-exercise="${w.exercise_id}">
        <div class="summary-dot"></div>
        <div class="summary-name">${escapeHtml(w.exercises.name)}</div>
        <div class="summary-sets">${formatSetsWithTime(w.reps_per_set, w.set_durations)}</div>
      </div>
    `)
    .join("");
  if (!reduceMotion && window.gsap) {
    gsap.from(el.children, { opacity: 0, x: -10, duration: 0.3, stagger: 0.04, ease: "power2.out" });
  }
}

// ---- PR celebration burst ----
function celebratePR(exerciseId) {
  const ex = state.exercises.find((e) => e.id === exerciseId);
  const color = ex ? ex.color : "#e2492e";
  const row = document.querySelector(`.summary-row[data-exercise="${exerciseId}"]`);
  let x = window.innerWidth / 2, y = 140;
  if (row) {
    const rect = row.getBoundingClientRect();
    x = rect.left + 12;
    y = rect.top + rect.height / 2;
    const badge = document.createElement("span");
    badge.className = "pr-badge";
    badge.textContent = "PR!";
    row.appendChild(badge);
  }
  if (reduceMotion || !window.gsap) return;
  for (let i = 0; i < 16; i++) {
    const dot = document.createElement("div");
    dot.className = "pr-burst";
    dot.style.background = color;
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    document.body.appendChild(dot);
    const angle = (Math.PI * 2 * i) / 16;
    const dist = 60 + Math.random() * 40;
    gsap.to(dot, {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      opacity: 0,
      scale: 0.3,
      duration: 0.7 + Math.random() * 0.3,
      ease: "power2.out",
      onComplete: () => dot.remove(),
    });
  }
}

// ============================================================
// Manage exercises modal
// ============================================================
document.getElementById("manage-exercises-btn").addEventListener("click", openManageModal);
document.getElementById("manage-close-btn").addEventListener("click", closeManageModal);
document.getElementById("manage-modal").addEventListener("click", (e) => {
  if (e.target.id === "manage-modal") closeManageModal();
});

function openManageModal() {
  renderManageList();
  const modal = document.getElementById("manage-modal");
  modal.hidden = false;
  if (!reduceMotion && window.gsap) {
    gsap.from(modal.querySelector(".modal-card"), { opacity: 0, y: 16, duration: 0.25, ease: "power2.out" });
  }
}
function closeManageModal() {
  document.getElementById("manage-modal").hidden = true;
}

function renderManageList() {
  const list = document.getElementById("manage-list");
  if (!state.allExercisesRaw.length) {
    list.innerHTML = `<div class="empty-state">No exercises yet.</div>`;
    return;
  }
  list.innerHTML = state.allExercisesRaw
    .map((ex) => `
      <div class="manage-row" data-id="${ex.id}">
        <div class="manage-dot" style="--dot-color:${ex.color}" data-action="cycle-color"></div>
        <input type="text" value="${escapeHtml(ex.name)}" data-action="rename" />
        ${ex.archived ? '<span class="archived-tag">Archived</span>' : ""}
        <div class="manage-actions">
          <button class="icon-btn" data-action="archive" title="${ex.archived ? "Unarchive" : "Archive"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
          </button>
          <button class="icon-btn" data-action="delete" title="Delete permanently">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    `)
    .join("");

  list.querySelectorAll('.manage-dot[data-action="cycle-color"]').forEach((dot) => {
    dot.addEventListener("click", async () => {
      const row = dot.closest(".manage-row");
      const id = row.dataset.id;
      const ex = state.allExercisesRaw.find((e) => e.id === id);
      const next = PLATE_COLORS[(PLATE_COLORS.indexOf(ex.color) + 1) % PLATE_COLORS.length];
      const { error } = await db.from("exercises").update({ color: next }).eq("id", id);
      if (error) { alert("Couldn't update color: " + error.message); return; }
      ex.color = next;
      row.querySelector(".manage-dot").style.setProperty("--dot-color", next);
      renderPlateGrid();
    });
  });

  list.querySelectorAll('input[data-action="rename"]').forEach((input) => {
    input.addEventListener("blur", async () => {
      const row = input.closest(".manage-row");
      const id = row.dataset.id;
      const ex = state.allExercisesRaw.find((e) => e.id === id);
      const newName = input.value.trim();
      if (!newName || newName === ex.name) { input.value = ex.name; return; }
      const { error } = await db.from("exercises").update({ name: newName }).eq("id", id);
      if (error) { alert("Couldn't rename: " + error.message); input.value = ex.name; return; }
      ex.name = newName;
      renderPlateGrid();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  });

  list.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".manage-row");
      const id = row.dataset.id;
      const ex = state.allExercisesRaw.find((e) => e.id === id);
      const { error } = await db.from("exercises").update({ archived: !ex.archived }).eq("id", id);
      if (error) { alert("Couldn't update: " + error.message); return; }
      ex.archived = !ex.archived;
      state.exercises = state.allExercisesRaw.filter((e) => !e.archived);
      renderManageList();
      renderPlateGrid();
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".manage-row");
      const id = row.dataset.id;
      const ex = state.allExercisesRaw.find((e) => e.id === id);
      const { count } = await db.from("workouts").select("id", { count: "exact", head: true }).eq("exercise_id", id);
      const n = count || 0;
      const warning = n > 0
        ? `Delete "${ex.name}"? This will permanently remove ${n} logged session${n > 1 ? "s" : ""} for this exercise, including any personal bests. This cannot be undone.`
        : `Delete "${ex.name}"? This cannot be undone.`;
      if (!confirm(warning)) return;
      const { error } = await db.from("exercises").delete().eq("id", id);
      if (error) { alert("Couldn't delete: " + error.message); return; }
      state.allExercisesRaw = state.allExercisesRaw.filter((e) => e.id !== id);
      state.exercises = state.allExercisesRaw.filter((e) => !e.archived);
      state.historyLoaded = false; // history/analytics data is now stale
      renderManageList();
      renderPlateGrid();
      await loadTodaysWorkouts();
    });
  });
}

// ============================================================
// Rendering: History view
// ============================================================
async function renderHistory() {
  await loadAllWorkouts();
  renderHeatmap();
  renderHistoryList();
}

function renderHeatmap() {
  const el = document.getElementById("heatmap");
  const days = 84;
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
    cells.push({ key, count: byDate[key] || 0 });
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
  if (!reduceMotion && window.gsap) {
    gsap.from(el.children, { opacity: 0, scale: 0.5, duration: 0.3, stagger: 0.004, ease: "power2.out" });
  }
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
              <div class="summary-sets">${formatSetsWithTime(w.reps_per_set, w.set_durations)}</div>
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

// ============================================================
// Rendering: Analytics view
// ============================================================
let progressChart = null;
let weeklyChart = null;

async function renderAnalytics() {
  if (!state.historyLoaded) await loadAllWorkouts();
  renderStatStrip();
  renderPersonalBests();
  renderTrends();
  renderWeeklyChart();
  renderExerciseSelect();
  wireChartControls();
}

function countUp(el, target, suffix = "") {
  if (reduceMotion || !window.gsap) { el.textContent = target + suffix; return; }
  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: 0.9,
    ease: "power2.out",
    onUpdate: () => { el.textContent = Math.round(obj.val) + suffix; },
  });
}

function renderStatStrip() {
  const el = document.getElementById("stat-strip");
  const dates = new Set(state.allWorkouts.map((w) => w.session_date));
  const totalSessions = dates.size;
  const totalSets = state.allWorkouts.reduce((sum, w) => sum + w.reps_per_set.length, 0);
  const totalReps = state.allWorkouts.reduce((sum, w) => sum + w.reps_per_set.reduce((a, b) => a + b, 0), 0);

  // Current streak: consecutive days (ending today or yesterday) with at least one session.
  let streak = 0;
  let cursor = new Date();
  const hasToday = dates.has(TODAY);
  if (!hasToday) cursor.setDate(cursor.getDate() - 1);
  while (true) {
    const key = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0") + "-" + String(cursor.getDate()).padStart(2, "0");
    if (dates.has(key)) { streak++; cursor.setDate(cursor.getDate() - 1); } else break;
  }

  el.innerHTML = `
    <div class="stat-card"><div class="stat-value" id="stat-sessions">0</div><div class="stat-label">Sessions</div></div>
    <div class="stat-card"><div class="stat-value" id="stat-sets">0</div><div class="stat-label">Sets logged</div></div>
    <div class="stat-card"><div class="stat-value" id="stat-reps">0</div><div class="stat-label">Total reps</div></div>
    <div class="stat-card"><div class="stat-value" id="stat-streak">0</div><div class="stat-label">Day streak</div></div>
  `;
  countUp(document.getElementById("stat-sessions"), totalSessions);
  countUp(document.getElementById("stat-sets"), totalSets);
  countUp(document.getElementById("stat-reps"), totalReps);
  countUp(document.getElementById("stat-streak"), streak);
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
  if (!reduceMotion && window.gsap) {
    gsap.from(el.children, { opacity: 0, y: 12, duration: 0.3, stagger: 0.05, ease: "power2.out" });
  }
}

function dateKeyDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function avgSetDuration(rows) {
  let total = 0, count = 0;
  rows.forEach((w) => {
    (w.set_durations || []).forEach((d) => { if (d != null) { total += d; count++; } });
  });
  return count ? total / count : null;
}

function renderTrends() {
  const el = document.getElementById("trend-grid");
  if (!el) return;
  const thisWeekStart = dateKeyDaysAgo(6);
  const lastWeekStart = dateKeyDaysAgo(13);
  const lastWeekEnd = dateKeyDaysAgo(7);

  const exerciseIds = [...new Set(state.allWorkouts.map((w) => w.exercise_id))];
  const cards = exerciseIds.map((id) => {
    const rows = state.allWorkouts.filter((w) => w.exercise_id === id);
    const sample = rows[0];
    const thisWeekRows = rows.filter((r) => r.session_date >= thisWeekStart);
    const lastWeekRows = rows.filter((r) => r.session_date >= lastWeekStart && r.session_date <= lastWeekEnd);
    const thisAvg = avgSetDuration(thisWeekRows);
    const lastAvg = avgSetDuration(lastWeekRows);
    return { name: sample.exercises.name, color: sample.exercises.color, thisAvg, lastAvg };
  });

  if (!cards.length) {
    el.innerHTML = `<div class="empty-state">Log a few sets with the stopwatch to see your pace trend.</div>`;
    return;
  }

  el.innerHTML = cards
    .map((c) => {
      if (c.thisAvg == null && c.lastAvg == null) {
        return `
          <div class="pb-card" style="--plate-color:${c.color}">
            <div class="pb-name">${escapeHtml(c.name)}</div>
            <div class="empty-state" style="padding:6px 0">No timed sets yet</div>
          </div>`;
      }
      if (c.thisAvg == null || c.lastAvg == null) {
        return `
          <div class="pb-card" style="--plate-color:${c.color}">
            <div class="pb-name">${escapeHtml(c.name)}</div>
            <div class="pb-value">${formatDuration(Math.round(c.thisAvg ?? c.lastAvg))}</div>
            <div class="pb-label">avg time / set</div>
            <div class="empty-state" style="padding:4px 0;font-size:11px">Not enough data yet to compare weeks</div>
          </div>`;
      }
      const delta = c.thisAvg - c.lastAvg;
      const pct = c.lastAvg ? Math.round((delta / c.lastAvg) * 100) : 0;
      const faster = delta < 0;
      const arrow = faster ? "&#8595;" : delta > 0 ? "&#8593;" : "&#8594;";
      const trendColor = faster ? "var(--green)" : delta > 0 ? "var(--red)" : "var(--text-muted)";
      return `
        <div class="pb-card" style="--plate-color:${c.color}">
          <div class="pb-name">${escapeHtml(c.name)}</div>
          <div class="pb-value">${formatDuration(Math.round(c.thisAvg))}</div>
          <div class="pb-label">avg time / set this week</div>
          <div class="trend-line" style="color:${trendColor}">
            ${arrow} ${Math.abs(pct)}% vs last week (${formatDuration(Math.round(c.lastAvg))})
          </div>
        </div>`;
    })
    .join("");
  if (!reduceMotion && window.gsap) {
    gsap.from(el.children, { opacity: 0, y: 12, duration: 0.3, stagger: 0.05, ease: "power2.out" });
  }
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return target.getFullYear() + "-W" + String(week).padStart(2, "0");
}

function renderWeeklyChart() {
  const wrap = document.getElementById("weekly-chart-wrap");
  if (!state.allWorkouts.length) {
    wrap.innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  wrap.innerHTML = `<canvas id="weekly-chart" height="200"></canvas>`;

  // last 10 ISO weeks
  const weekKeys = [];
  const now = new Date();
  for (let i = 9; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const key = isoWeekKey(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    if (!weekKeys.includes(key)) weekKeys.push(key);
  }

  const exerciseIds = [...new Set(state.allWorkouts.map((w) => w.exercise_id))];
  const datasets = exerciseIds.map((id) => {
    const sample = state.allWorkouts.find((w) => w.exercise_id === id);
    const perWeek = weekKeys.map((wk) =>
      state.allWorkouts
        .filter((w) => w.exercise_id === id && isoWeekKey(w.session_date) === wk)
        .reduce((sum, w) => sum + w.reps_per_set.reduce((a, b) => a + b, 0), 0)
    );
    return {
      label: sample.exercises.name,
      data: perWeek,
      backgroundColor: sample.exercises.color,
      stack: "vol",
    };
  });

  if (weeklyChart) weeklyChart.destroy();
  const ctx = document.getElementById("weekly-chart").getContext("2d");
  weeklyChart = new Chart(ctx, {
    type: "bar",
    data: { labels: weekKeys, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { color: "#8d92a0", boxWidth: 10 } } },
      scales: {
        x: { stacked: true, ticks: { color: "#8d92a0" }, grid: { display: false } },
        y: { stacked: true, ticks: { color: "#8d92a0" }, grid: { color: "rgba(242,239,233,0.06)" }, beginAtZero: true },
      },
    },
  });
}

function renderExerciseSelect() {
  const select = document.getElementById("exercise-select");
  const ids = [...new Set(state.allWorkouts.map((w) => w.exercise_id))];
  if (!ids.length) {
    document.getElementById("chart-wrap").innerHTML = `<div class="empty-state">No data yet.</div>`;
    return;
  }
  const seen = new Set();
  const uniqueByName = [];
  ids.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const w = state.allWorkouts.find((w) => w.exercise_id === id);
    uniqueByName.push({ id, name: w.exercises.name });
  });
  select.innerHTML = uniqueByName.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  select.onchange = () => renderChart(select.value);
  renderChart(uniqueByName[0].id);
}

function wireChartControls() {
  document.querySelectorAll("#metric-toggle button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#metric-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartMetric = btn.dataset.metric;
      renderChart(document.getElementById("exercise-select").value);
    };
  });
  document.querySelectorAll("#range-toggle button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#range-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartRange = btn.dataset.range;
      renderChart(document.getElementById("exercise-select").value);
    };
  });
}

function renderChart(exerciseId) {
  const wrap = document.getElementById("chart-wrap");
  wrap.innerHTML = `<canvas id="progress-chart" height="220"></canvas>`;

  let rows = state.allWorkouts
    .filter((w) => w.exercise_id === exerciseId)
    .sort((a, b) => a.session_date.localeCompare(b.session_date));

  if (state.chartRange !== "all") {
    const days = parseInt(state.chartRange, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffKey = cutoff.getFullYear() + "-" + String(cutoff.getMonth() + 1).padStart(2, "0") + "-" + String(cutoff.getDate()).padStart(2, "0");
    rows = rows.filter((r) => r.session_date >= cutoffKey);
  }

  const labels = rows.map((r) => r.session_date);
  const values = rows.map((r) => {
    if (state.chartMetric === "best") return Math.max(...r.reps_per_set);
    if (state.chartMetric === "sets") return r.reps_per_set.length;
    return r.reps_per_set.reduce((a, b) => a + b, 0);
  });
  const metricLabel = state.chartMetric === "best" ? "Best single set" : state.chartMetric === "sets" ? "Sets logged" : "Total reps";
  const color = rows.length ? rows[0].exercises.color : "#3f86e0";

  if (progressChart) progressChart.destroy();
  const ctx = document.getElementById("progress-chart").getContext("2d");
  progressChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: metricLabel,
        data: values,
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
        x: { ticks: { color: "#8d92a0" }, grid: { color: "rgba(242,239,233,0.06)" } },
        y: { ticks: { color: "#8d92a0" }, grid: { color: "rgba(242,239,233,0.06)" }, beginAtZero: true },
      },
    },
  });
}

