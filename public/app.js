/* ======= CONFIG ======= */
const API_BASE = ""; // same origin. If different server, set full base URL here.

let AUTH = { token: null, me: null };

/* ======= HELPERS ======= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function showFlex(el) { el.classList.remove("hidden"); el.classList.add("flex"); }
function showBlock(el) { el.classList.remove("hidden"); el.classList.add("block"); }
function hide(el) { el.classList.add("hidden"); el.classList.remove("flex", "block"); }

function headersJson() {
  const h = { "Content-Type": "application/json" };
  if (AUTH.token) h.Authorization = `Bearer ${AUTH.token}`;
  return h;
}
async function apiGet(p) { const r = await fetch(API_BASE + p, { headers: headersJson() }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function apiPost(p, b) { const r = await fetch(API_BASE + p, { method: "POST", headers: headersJson(), body: JSON.stringify(b || {}) }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function apiPut(p, b) { const r = await fetch(API_BASE + p, { method: "PUT", headers: headersJson(), body: JSON.stringify(b || {}) }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function apiDelete(p) { const r = await fetch(API_BASE + p, { method: "DELETE", headers: headersJson() }); if (!r.ok) throw new Error(await r.text()); return r.json(); }

function fmtDate(d) { try { return new Date(d).toLocaleString(); } catch { return String(d) } }
function escapeHtml(s) { return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

/* ======= DOM ======= */
const loginScreen = $("#loginScreen");
const appScreen = $("#appScreen");
const loginEmail = $("#loginEmail"), loginPassword = $("#loginPassword"), loginBtn = $("#loginBtn"), loginErr = $("#loginErr");
const meName = $("#meName"), meEmail = $("#meEmail"), helloName = $("#helloName"), logoutBtn = $("#logoutBtn");
const navLinks = $$(".menu a[data-view]");

const viewDashboard = $("#viewDashboard");
const viewUsers = $("#viewUsers");
const viewQsets = $("#viewQsets");
const viewAdmins = $("#viewAdmins");

const statRecordings = $("#statRecordings"), statUsers = $("#statUsers"), statAdmins = $("#statAdmins");

const recBody = $("#recBody"), searchInput = $("#searchInput"), sortSelect = $("#sortSelect"), prevPageBtn = $("#prevPage"), nextPageBtn = $("#nextPage"), pageInfo = $("#pageInfo");
const refreshRecsBtn = $("#refreshRecs");

const usersSearch = $("#usersSearch"), usersRefresh = $("#usersRefresh"), usersBody = $("#usersBody"), usersCount = $("#usersCount");

const addModal = $("#addInterviewerModal"), openAddBtn = $("#openAddInterviewer"), closeAddBtn = $("#closeAddInterviewer");
const addUUsername = $("#addUUsername"), addUEmail = $("#addUEmail"), addUPassword = $("#addUPassword"), addUPhone = $("#addUPhone"), addIError = $("#addIError");
const createInterviewerBtn = $("#createInterviewerBtn");

const userModal = $("#userModal"), closeUserModal = $("#closeUserModal"), userJson = $("#userJson"), userRecs = $("#userRecs");
const recModal = $("#recModal"), closeRecModal = $("#closeRecModal"), recContent = $("#recContent")


// Question sets editor DOM
const qTitle = $("#qTitle");
const qDesc = $("#qDesc");
const qList = $("#qList");
const addQItemBtn = $("#addQItem");
const saveQBtn = $("#saveQBtn");
const deleteQBtn = $("#deleteQBtn");
const newQBtn = $("#newQBtn");

/* ======= STATE ======= */
let dash = { page: 1, limit: 20, total: 0, query: "", sort: "new", items: [] };
let usersState = { query: "", list: [] };
let currentUserForModal = null;

// recordings count cache: userId -> number
const userRecCount = {};
async function fetchUserRecordingCount(userId) {
  if (userRecCount[userId] != null) return userRecCount[userId];
  const data = await apiGet(`/api/admin/users/${userId}/recordings`);
  const n = (data.items || []).length;
  userRecCount[userId] = n;
  return n;
}

/* ======= AUTH ======= */
loginBtn.addEventListener("click", async () => {
  loginErr.textContent = "";
  try {
    const email = (loginEmail.value || "").trim();
    const password = (loginPassword.value || "").trim();
    const { token } = await apiPost("/api/admin/login", { email, password });
    AUTH.token = token;
    AUTH.me = await apiGet("/api/admin/me");
    meName.textContent = AUTH.me.name || "(admin)";
    meEmail.textContent = AUTH.me.email || "";
    helloName.textContent = AUTH.me.name || "Administrator";
    hide(loginScreen); showFlex(appScreen);
    await loadDashboard();
  } catch (e) {
    console.error(e);
    loginErr.textContent = "Login failed. " + (e.message || "");
  }
});
if (refreshRecsBtn) {
  refreshRecsBtn.addEventListener("click", () => {
    console.log("Refresh button clicked!");
    loadDashboard();
  });
}



logoutBtn.addEventListener("click", () => {
  AUTH = { token: null, me: null };
  showFlex(loginScreen); hide(appScreen);
});

/* ======= NAV ======= */
navLinks.forEach(a => a.addEventListener("click", (e) => {
  e.preventDefault();
  navLinks.forEach(n => n.classList.remove("active"));
  a.classList.add("active");
  const view = a.dataset.view;
  [viewDashboard, viewUsers, viewQsets, viewAdmins].forEach(h => h.classList.add("hidden"));
  if (view === "dashboard") { viewDashboard.classList.remove("hidden"); loadDashboard(); }
  if (view === "users") { viewUsers.classList.remove("hidden"); loadUsers(); }
  if (view === "qsets") { viewQsets.classList.remove("hidden"); loadQsets(); }
  if (view === "admins") { viewAdmins.classList.remove("hidden"); }
}));

/* ======= STATS ======= */
async function loadStats() {
  try {
    const s = await apiGet("/api/admin/stats");
    statRecordings.textContent = s.totalRecordings ?? 0;
    statUsers.textContent = s.totalUsers ?? 0;
    statAdmins.textContent = s.totalAdmins ?? 0;
  } catch (e) { console.warn("stats:", e.message); }
}

/* ======= DASHBOARD ======= */
searchInput.addEventListener("input", () => { dash.query = searchInput.value.trim(); dash.page = 1; loadDashboard(); });
sortSelect.addEventListener("change", () => { dash.sort = sortSelect.value; dash.page = 1; loadDashboard(); });
prevPageBtn.addEventListener("click", () => { if (dash.page > 1) { dash.page--; loadDashboard(); } });
nextPageBtn.addEventListener("click", () => { const pages = Math.ceil(dash.total / dash.limit); if (dash.page < pages) { dash.page++; loadDashboard(); } });

if (refreshRecsBtn) {
  refreshRecsBtn.addEventListener("click", () => loadDashboard());
}

async function loadDashboard() {
  console.log("🔄 Loading dashboard…");

  try {
    await loadStats();
    console.log("✅ Stats loaded");

    const url = `/api/admin/recordings?page=${dash.page}&limit=${dash.limit}`;
    console.log("📡 Fetching:", url);

    const data = await apiGet(url);
    console.log("📦 API response:", data);

    dash.items = data.items || [];
    dash.total = data.total || 0;

    let rows = [...dash.items];
    const q = (dash.query || "").toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        [r.email, r.file_name, r.question_set, r.interviewee_name]
          .filter(Boolean)
          .some(s => String(s).toLowerCase().includes(q))
      );
    }

    rows.sort((a, b) => {
      const da = +new Date(a.uploaded_at || 0);
      const db = +new Date(b.uploaded_at || 0);
      return dash.sort === "old" ? da - db : db - da;
    });

    recBody.innerHTML = rows.map(r => {
      const label = r.username
        ? `${escapeHtml(r.username)} (${escapeHtml(r.email || "-")})`
        : `${escapeHtml(r.email || "-")}`;
      return `
        <tr>
          <td>${label}</td>
          <td>${fmtDate(r.uploaded_at)}</td>
          <td>${r.question_set || "-"}</td>
          <td>${r.interviewee_name ? escapeHtml(r.interviewee_name.replace(/"/g, "")) : "-"}</td>
          <td>
            <button class="text-blue-700 underline" data-open-rec='${encodeURIComponent(r.file_name || "")}'>
              ${r.file_name}
            </button>
          </td>
        </tr>`;
    }).join("");

    pageInfo.textContent = `Page ${dash.page} of ${Math.max(1, Math.ceil(dash.total / dash.limit))}`;

    $$("#recBody [data-open-rec]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const fileName = decodeURIComponent(btn.getAttribute("data-open-rec"));
        console.log("📂 Opening recording:", fileName);
        await openRecordingDetailsByFile(fileName);
      });
    });

    console.log("✅ Dashboard updated with", rows.length, "rows");
  } catch (err) {
    console.error("❌ loadDashboard error:", err);
    recBody.innerHTML = `<tr><td colspan="5" class="text-red-600">Failed to load recordings</td></tr>`;
    pageInfo.textContent = "Error";
  }
}


/* ======= QUESTION SETS ======= */
let editingQset = null;

async function loadQsets() {
  try {
    const res = await apiGet("/api/qsets?grouped=true");
    const data = res.data || [];
    const list = document.getElementById("qsetsList");
    list.innerHTML = "";

    if (!data.length) {
      list.innerHTML = `<p class="text-gray-500">No question sets found</p>`;
      openQsetEditor(null);
      return;
    }

    data.forEach((set) => {
      const div = document.createElement("div");
      div.className = "bg-white rounded-xl p-4 shadow";

      div.innerHTML = `
        <h4 class="font-semibold mb-2">${escapeHtml(set.setName)}</h4>
        <p class="text-xs text-gray-500 mb-2">Questions: ${set.count}</p>
        <ul class="list-disc pl-5 space-y-1 mb-3">
          ${set.questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}
        </ul>
        <div class="flex gap-2">
          <button class="px-3 py-1 border rounded bg-blue-600 text-white" data-edit-name="${encodeURIComponent(set.setName)}">Edit</button>
          <button class="px-3 py-1 border rounded bg-red-600 text-white" data-del-name="${encodeURIComponent(set.setName)}">Delete</button>
        </div>
      `;
      list.appendChild(div);
    });

    // Edit: load into editor
    $$("#qsetsList [data-edit-name]").forEach(btn => {
      btn.addEventListener("click", () => {
        const name = decodeURIComponent(btn.dataset.editName);
        const set = (res.data || []).find(s => s.setName === name);
        openQsetEditor(set || null);
      });
    });

    // Delete: call backend
    $$("#qsetsList [data-del-name]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const setName = decodeURIComponent(btn.dataset.delName);
        if (!confirm(`Delete "${setName}"?`)) return;
        await apiDelete(`/api/qsets/${encodeURIComponent(setName)}`);
        if (editingQset && editingQset.setName === setName) editingQset = null;
        await loadQsets();
        openQsetEditor(null);
      });
    });

  } catch (err) {
    console.error("Failed to load question sets:", err);
    document.getElementById("qsetsList").innerHTML = `<p class="text-red-600">Error loading question sets</p>`;
  }
}

function openQsetEditor(set = null) {
  editingQset = set;
  qTitle.value = set ? set.setName : "";
  qDesc.value = set && set.description ? set.description : "";
  qList.innerHTML = "";

  const questions = set ? (set.questions || [""]) : [""];
  questions.forEach(q => addQRow(q));
}

function addQRow(value = "") {
  const div = document.createElement("div");
  div.className = "flex gap-2";
  div.innerHTML = `
    <input type="text" class="border rounded p-2 flex-1" value="${escapeHtml(value)}" placeholder="Enter question" />
    <button type="button" class="px-2 py-1 border rounded bg-red-500 text-white">✕</button>
  `;
  div.querySelector("button").addEventListener("click", () => div.remove());
  qList.appendChild(div);
}
addQItemBtn.addEventListener("click", () => addQRow());
newQBtn.addEventListener("click", () => openQsetEditor(null));

saveQBtn.addEventListener("click", async () => {
  const newName = qTitle.value.trim();
  const questions = Array.from(qList.querySelectorAll("input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  if (!newName) { alert("Title is required"); return; }
  if (!questions.length) { alert("Please add at least 1 question"); return; }

  if (!editingQset) {
    await apiPost("/api/qsets", { setName: newName, questions });
  } else if (editingQset.setName === newName) {
    await apiPut(`/api/qsets/${encodeURIComponent(newName)}`, { questions });
  } else {
    await apiDelete(`/api/qsets/${encodeURIComponent(editingQset.setName)}`);
    await apiPost("/api/qsets", { setName: newName, questions });
  }

  await loadQsets();
  openQsetEditor(null);
});

deleteQBtn.addEventListener("click", async () => {
  if (!editingQset) { alert("No question set selected for deletion."); return; }
  const setName = editingQset.setName;
  if (!confirm(`Delete "${setName}"?`)) return;

  await apiDelete(`/api/qsets/${encodeURIComponent(setName)}`);
  editingQset = null;
  await loadQsets();
  openQsetEditor(null);
});


/* ======= USERS ======= */
usersSearch.addEventListener("input", () => { usersState.query = usersSearch.value.trim(); renderUsers(); });
usersRefresh.addEventListener("click", async () => { await loadStats(); await loadUsers(); });

async function loadUsers() {
  const qParam = usersState.query ? `?q=${encodeURIComponent(usersState.query)}` : "";
  const data = await apiGet(`/api/admin/users${qParam}`);
  usersState.list = data.users || [];
  await Promise.all(usersState.list.map(u =>
    fetchUserRecordingCount(u._id).catch(() => { userRecCount[u._id] = 0; })
  ));
  renderUsers();
}

function renderUsers() {
  let list = [...(usersState.list || [])];
  const q = (usersState.query || "").toLowerCase();
  if (q) {
    list = list.filter(u =>
      [u.username, u.email].filter(Boolean).some(s => String(s).toLowerCase().includes(q))
    );
  }

  usersBody.innerHTML = list.map(u => {
    const count = userRecCount[u._id];
    const created = u.createdAt ? fmtDate(u.createdAt) : "-";
    return `
      <tr>
        <td><button class="text-blue-700 underline" data-open-user="${u._id}">
          ${u.username ? escapeHtml(u.username) : "-"}</button></td>
        <td>${u.email ? escapeHtml(u.email) : "-"}</td>
        <td>${u.phone ? escapeHtml(u.phone) : "-"}</td>
        <td>${created !== "Invalid Date" ? created : "-"}</td>
        <td class="chip">${Number.isFinite(count) ? count : "0"}</td>
      </tr>
    `;
  }).join("");

  usersCount.textContent = `${list.length} user(s)`;

  $$("#usersBody [data-open-user]").forEach(b => {
    b.addEventListener("click", () => openUserModal(b.getAttribute("data-open-user")));
  });
}

/* ======= ADD USER MODAL ======= */
openAddBtn.addEventListener("click", (e) => { e.preventDefault(); addIError.textContent = ""; showFlex(addModal); });
closeAddBtn.addEventListener("click", () => hide(addModal));
createInterviewerBtn.addEventListener("click", async () => {
  addIError.textContent = "";
  try {
    const payload = {
      username: (addUUsername.value || "").trim(),
      email: (addUEmail.value || "").trim(),
      password: (addUPassword.value || "").trim(),
      phone: (addUPhone.value || "").trim(),
    };
    await apiPost("/api/admin/users", payload);
    hide(addModal);
    await loadStats();
    if (!viewUsers.classList.contains("hidden")) await loadUsers();
    addUUsername.value = addUEmail.value = addUPassword.value = addUPhone.value = "";
  } catch (e) {
    try { const j = JSON.parse(e.message); addIError.textContent = j.error || e.message; }
    catch { addIError.textContent = e.message || "Error"; }
  }
});

/* ======= USER & RECORDING MODALS ======= */
async function openUserModal(userId) {
  currentUserForModal = await apiGet(`/api/admin/users/${userId}`);
  const recs = await apiGet(`/api/admin/users/${userId}/recordings`);

  userJson.textContent = JSON.stringify(
    { _id: currentUserForModal._id, email: currentUserForModal.email, username: currentUserForModal.username },
    null, 2
  );

  userRecs.innerHTML = (recs.items || []).map(r => `
    <tr>
      <td>${fmtDate(r.uploaded_at)}</td>
      <td><button class="text-blue-700 underline" data-open-rec-file='${encodeURIComponent(r.file_name)}'>
        ${r.file_name}</button></td>
      <td>${r.question_set || "-"}</td>
      <td>${r.interviewee_name ? escapeHtml(r.interviewee_name.replace(/"/g, "")) : "-"}</td>
    </tr>
  `).join("");

  $$("#userRecs [data-open-rec-file]").forEach(b => {
    b.addEventListener("click", async () => {
      const file = decodeURIComponent(b.getAttribute("data-open-rec-file"));
      await openRecordingDetailsByFile(file);
    });
  });

  showFlex(userModal);
}
closeUserModal.addEventListener("click", () => hide(userModal));

closeRecModal.addEventListener("click", () => hide(recModal));

async function openRecordingDetailsByFile(fileName) {
  try {
    const rec = await apiGet(`/api/admin/recordings/by-file/${encodeURIComponent(fileName)}`);
    await renderRecordingDetail(rec);
    await loadDashboard();
  } catch (e) { renderRecError(e); }
}
async function openRecordingDetailsById(id) {
  try {
    const rec = await apiGet(`/api/admin/recordings/${id}`);
    await renderRecordingDetail(rec);
    await loadDashboard();
  } catch (e) { renderRecError(e); }
}
function renderRecError(e) {
  recContent.innerHTML = `<div class="text-red-600">Failed to load recording. ${e.message || ""}</div>`;
  showFlex(recModal);
}
async function renderRecordingDetail(rec) {
  let audioHtml = "";
  try {
    const a = await apiGet(`/api/admin/recordings/${rec._id}/audio`);
    if (a && a.audio_url) {
      audioHtml = `
        <div>
          <div class="font-semibold mb-1">Audio Preview</div>
          <audio controls class="w-full" src="${a.audio_url}"></audio>
          <div class="text-xs text-gray-500 mt-1">Temporary link expires in ${a.expires_in}s</div>
        </div>`;
    }
  } catch { }

  const list = (arr, ordered = false) =>
    Array.isArray(arr) && arr.length
      ? `<${ordered ? "ol" : "ul"} class="${ordered ? "list-decimal" : "list-disc"} list-inside space-y-1">` +
      arr.map(x => `<li>${escapeHtml(x)}</li>`).join("") +
      `</${ordered ? "ol" : "ul"}>`
      : "—";

  recContent.innerHTML = `
    <div class="text-xs text-gray-500">
      File: <span class="font-mono">${escapeHtml(rec.file_name || "")}</span><br/>
      Uploaded: ${fmtDate(rec.uploaded_at)} • QSet: ${escapeHtml(rec.question_set || "-")} • Sentiment: ${escapeHtml(rec.sentiment || "-")}
    </div>
    <div><div class="font-semibold mb-1">Summary</div>
      <div class="rounded border p-3">${escapeHtml(rec.summary || "—")}</div></div>
    <div><div class="font-semibold mb-1">Transcript</div>
      <div class="rounded border p-3 whitespace-pre-wrap">${escapeHtml(rec.transcript || "—")}</div></div>
    <div><div class="font-semibold mb-1">Key Points</div>
      <div class="rounded border p-3">${list(rec.key_points)}</div></div>
    <div><div class="font-semibold mb-1">AI Suggestions</div>
      <div class="rounded border p-3">${list(rec.suggestions)}</div></div>
    <div><div class="font-semibold mb-1">Action Items</div>
      <div class="rounded border p-3">${list(rec.action_items, true)}</div></div>
    ${audioHtml}
  `;
  showFlex(recModal);
}

/* ======= BOOT ======= */
// (no auto-boot; user logs in)
