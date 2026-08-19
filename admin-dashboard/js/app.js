import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.ATTENDANCE_CONFIG || {};
let client = null;
let session = null;

const $ = (sel) => document.querySelector(sel);
const view = () => document.getElementById("view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDT = (iso) => new Date(iso).toLocaleString([], {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const isAdminError = (e) => String(e?.message || e).includes("admin_only");

init();

async function init() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    view().innerHTML = `<div class="panel"><h2>Not configured</h2>
      <p>Open <b>js/config.js</b> and paste your Supabase project URL and anon key.</p></div>`;
    return;
  }
  client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const { data } = await client.auth.getSession();
  session = data.session;

  client.auth.onAuthStateChange((_event, s) => {
    session = s;
    render();
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await client.auth.signOut();
    render();
  });

  window.addEventListener("hashchange", render);
  render();
}

/* ------------------------------------------------------------------ */
/* Routing / shell                                                     */
/* ------------------------------------------------------------------ */

const VIEWS = ["dashboard", "live", "records", "overrides", "settings"];

function currentView() {
  const h = window.location.hash.replace(/^#\//, "");
  return VIEWS.includes(h) ? h : "dashboard";
}

async function render() {
  if (!session) { renderLogin(); return; }

  $("#header").hidden = false;
  $("#userLabel").textContent = session.user.email;
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === currentView());
  });

  const v = view();
  v.innerHTML = "";
  try {
    switch (currentView()) {
      case "live": await renderLive(v); break;
      case "records": await renderRecords(v); break;
      case "overrides": await renderOverrides(v); break;
      case "settings": await renderSettings(v); break;
      default: await renderDashboard(v);
    }
  } catch (e) {
    v.innerHTML = `<div class="msg err">${esc(e?.message || e)}</div>` +
      (isAdminError(e) ? `<div class="panel">This account is not an admin. ` +
        `Ask the school admin to set your role to <b>admin</b> in the employees table.</div>` : "");
  }
}

function renderLogin() {
  $("#header").hidden = true;
  view().innerHTML = `
    <div class="login-wrap">
      <div class="panel">
        <h2>Cabiao SHS — Admin</h2>
        <form id="loginForm">
          <div><label>Email</label><input type="email" id="loginEmail" required autocomplete="username"></div>
          <div><label>Password</label><input type="password" id="loginPass" required autocomplete="current-password"></div>
          <div class="form-actions"><button type="submit">LOG IN</button></div>
        </form>
        <div id="loginMsg" style="margin-top:10px"></div>
      </div>
    </div>`;
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = $("#loginMsg");
    box.className = "msg";
    try {
      await client.auth.signInWithPassword({
        email: $("#loginEmail").value.trim(),
        password: $("#loginPass").value,
      });
    } catch (err) {
      box.className = "msg err";
      box.textContent = "Invalid email or password.";
    }
  });
}

/* ------------------------------------------------------------------ */
/* API helpers                                                         */
/* ------------------------------------------------------------------ */

async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

async function fetchEmployees() {
  const { data, error } = await client.from("employees")
    .select("id, employee_id, full_name, first_name, middle_name, last_name, email, role, is_active, created_at")
    .order("full_name");
  if (error) throw error;
  return data;
}

async function fetchDevices() {
  const { data, error } = await client.from("devices")
    .select("employee_id, device_name, android_id, bound_at");
  if (error) throw error;
  return data;
}

async function fetchAttendance(fromISO, toISO) {
  const { data, error } = await client.from("attendance")
    .select("*")
    .gte("checked_at", fromISO)
    .lt("checked_at", toISO)
    .order("checked_at");
  if (error) throw error;
  return data;
}

async function fetchSettings() {
  const { data, error } = await client.from("settings").select("key, value");
  if (error) throw error;
  return Object.fromEntries(data.map((s) => [s.key, s.value]));
}

function localDayRange(d) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start.getTime() + 86400000);
  return [start.toISOString(), end.toISOString()];
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

async function renderDashboard(v) {
  const [employees, devices] = await Promise.all([fetchEmployees(), fetchDevices()]);
  const devicesByEmployee = {};
  devices.forEach((d) => {
    (devicesByEmployee[d.employee_id] ||= []).push(d);
  });
  const status = await rpc("admin_current_status");
  const [from, to] = localDayRange(new Date());
  const today = await fetchAttendance(from, to);

  const clockedIn = status.length;
  const recordsToday = today.length;
  const activeCount = employees.filter((e) => e.is_active).length;

  v.innerHTML = `
    <div class="cards">
      <div class="card"><div class="num">${clockedIn}</div><div class="lbl">Clocked in now</div></div>
      <div class="card"><div class="num">${recordsToday}</div><div class="lbl">Records today</div></div>
      <div class="card"><div class="num">${activeCount}</div><div class="lbl">Active employees</div></div>
    </div>
    <div class="panel">
      <h2>Employees (${employees.length})</h2>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Devices</th><th></th></tr></thead>
        <tbody>
          ${employees.map((e) => {
            const devs = devicesByEmployee[e.id] || [];
            return `<tr>
              <td><b>${esc(e.employee_id || "—")}</b></td>
              <td>${esc(e.full_name)}</td>
              <td>${esc(e.email)}</td>
              <td>${esc(e.role)}</td>
              <td>${e.is_active ? '<span class="badge in">active</span>' : '<span class="badge off">disabled</span>'}</td>
              <td class="muted">
                ${devs.length ? devs.map((d) =>
                  `<span class="dev-chip">${esc(d.device_name || "phone")} · ${esc(d.android_id)}` +
                  ` <button class="link remove-device" data-email="${esc(e.email)}" data-android="${esc(d.android_id)}" title="Remove this phone">✕</button></span>`
                ).join(" ") : "not bound"}
                ${devs.length ? `<button class="secondary reset-devices" data-email="${esc(e.email)}" data-name="${esc(e.full_name)}">Reset devices</button>` : ""}
              </td>
              <td>
                <button class="secondary toggle-active" data-email="${esc(e.email)}" data-active="${e.is_active}">
                  ${e.is_active ? "Disable" : "Enable"}</button>
                <button class="secondary edit-employee" data-id="${esc(e.employee_id || "")}">Edit</button>
              </td>
            </tr>`;
          }).join("") || `<tr><td colspan="7" class="empty">No employees yet.</td></tr>`}
        </tbody>
      </table>
      <div id="editEmpPanel" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <h3>Edit employee</h3>
        <form id="editEmpForm">
          <div><label>Current employee ID</label><input id="eeCurId" readonly></div>
          <div><label>First name</label><input id="eeFirst" required></div>
          <div><label>Middle name</label><input id="eeMid"></div>
          <div><label>Last name</label><input id="eeLast"></div>
          <div><label>Email</label><input id="eeEmail" type="email" required></div>
          <div><label>Employee ID (7 digits)</label><input id="eeId" required pattern="[0-9]{7}" inputmode="numeric"></div>
          <div><label>Role</label>
            <select id="eeRole"><option value="employee">Employee</option><option value="admin">Admin</option></select>
          </div>
          <div class="form-actions">
            <button type="submit">Save changes</button>
            <button type="button" class="secondary" id="eeCancel">Cancel</button>
          </div>
        </form>
        <div id="editMsg" style="margin-top:10px"></div>
      </div>
      <div style="margin-top:14px">
        <h2>Register employee</h2>
        <form id="addEmpForm">
          <div><label>First name</label><input id="aeFirst" required></div>
          <div><label>Middle name</label><input id="aeMid"></div>
          <div><label>Last name</label><input id="aeLast"></div>
          <div><label>Email</label><input id="aeEmail" type="email" required></div>
          <div><label>Employee ID (7 digits — also their login password)</label><input id="aeId" required pattern="[0-9]{7}" inputmode="numeric" maxlength="7"></div>
          <div><label>Role</label>
            <select id="aeRole"><option value="employee">Employee</option><option value="admin">Admin</option></select>
          </div>
          <div class="form-actions"><button type="submit">Add employee</button></div>
        </form>
        <div id="addMsg" style="margin-top:10px"></div>
      </div>
    </div>`;

  v.querySelectorAll(".toggle-active").forEach((btn) => btn.addEventListener("click", async () => {
    const email = btn.dataset.email;
    const active = btn.dataset.active === "true";
    try {
      await rpc("admin_set_active", { p_email: email, p_active: !active });
      await renderDashboard(v);
    } catch (e) {
      flash(v, String(e.message), true);
    }
  }));

  v.querySelectorAll(".remove-device").forEach((btn) => btn.addEventListener("click", async () => {
    const email = btn.dataset.email;
    const androidId = btn.dataset.android;
    if (!confirm(`Remove the phone ${androidId} from ${email}?\nThe employee can then bind a new phone.`)) return;
    try {
      await rpc("admin_unbind_device", { p_employee_email: email, p_android_id: androidId });
      await renderDashboard(v);
    } catch (e) {
      flash(v, String(e.message), true);
    }
  }));

  v.querySelectorAll(".reset-devices").forEach((btn) => btn.addEventListener("click", async () => {
    const email = btn.dataset.email;
    const name = btn.dataset.name;
    if (!confirm(`Release ALL phones bound to ${name} (${email})?\nThe employee must bind a phone again before checking in.`)) return;
    try {
      await rpc("admin_unbind_device", { p_employee_email: email });
      await renderDashboard(v);
    } catch (e) {
      flash(v, String(e.message), true);
    }
  }));

  const byId = Object.fromEntries(employees.map((e) => [e.employee_id, e]));
  v.querySelectorAll(".edit-employee").forEach((btn) => btn.addEventListener("click", () => {
    const emp = byId[btn.dataset.id];
    if (!emp) return;
    $("#editEmpPanel").style.display = "block";
    $("#editEmpPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#eeCurId").value = emp.employee_id || "";
    $("#eeFirst").value = emp.first_name || "";
    $("#eeMid").value = emp.middle_name || "";
    $("#eeLast").value = emp.last_name || "";
    $("#eeEmail").value = emp.email || "";
    $("#eeId").value = emp.employee_id || "";
    $("#eeRole").value = emp.role || "employee";
    $("#editMsg").textContent = "";
    $("#editMsg").className = "msg";
  }));
  $("#eeCancel").addEventListener("click", () => {
    $("#editEmpPanel").style.display = "none";
  });
  $("#editEmpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = $("#editMsg");
    const oldId = $("#eeCurId").value.trim();
    const newId = $("#eeId").value.trim();
    try {
      const res = await rpc("admin_update_employee", {
        p_current_employee_id: oldId,
        p_email: $("#eeEmail").value.trim(),
        p_first_name: $("#eeFirst").value.trim(),
        p_middle_name: $("#eeMid").value.trim() || null,
        p_last_name: $("#eeLast").value.trim() || null,
        p_employee_id: newId,
        p_role: $("#eeRole").value,
      });
      box.className = "msg ok";
      box.textContent = newId !== oldId
        ? `Saved. The new employee ID ${res.employee_id} is now the login password.`
        : "Employee updated.";
      await renderDashboard(v);
    } catch (err) {
      box.className = "msg err";
      box.textContent = err.message || "Failed to update employee.";
    }
  });

  $("#addEmpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = $("#addMsg");
    const empId = $("#aeId").value.trim();
    if (!/^\d{7}$/.test(empId)) {
      box.className = "msg err";
      box.textContent = "Employee ID must be exactly 7 digits.";
      return;
    }
    try {
      const res = await rpc("admin_register_employee", {
        p_email: $("#aeEmail").value.trim(),
        p_employee_id: empId,
        p_first_name: $("#aeFirst").value.trim(),
        p_middle_name: $("#aeMid").value.trim() || null,
        p_last_name: $("#aeLast").value.trim() || null,
        p_role: $("#aeRole").value,
      });
      box.className = "msg ok";
      box.textContent = `Registered. Employee ID ${res.employee_id} is also their login password.`;
      $("#aeFirst").value = ""; $("#aeMid").value = ""; $("#aeLast").value = "";
      $("#aeEmail").value = ""; $("#aeId").value = "";
      await renderDashboard(v);
    } catch (err) {
      box.className = "msg err";
      box.textContent = err.message || "Failed to register employee.";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Live status                                                         */
/* ------------------------------------------------------------------ */

async function renderLive(v) {
  const status = await rpc("admin_current_status");
  v.innerHTML = `
    <div class="panel">
      <h2>Clocked in now (${status.length})</h2>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Time in</th><th>Mode</th><th>Distance</th><th>Note</th></tr></thead>
        <tbody>
          ${status.map((s) => `<tr>
            <td>${esc(s.full_name)}</td>
            <td>${esc(s.email)}</td>
            <td>${fmtTime(s.checked_at)}</td>
            <td><span class="badge ${s.mode === "outside" ? "out" : "in"}">${esc((s.mode || "inside").toUpperCase())}</span></td>
            <td class="muted">${s.distance_m != null ? Math.round(s.distance_m) + " m" : "—"}</td>
            <td class="muted">${esc(s.note || "—")}</td>
          </tr>`).join("") ||
          `<tr><td colspan="6" class="empty">Nobody is clocked in right now.</td></tr>`}
        </tbody>
      </table>
      <p class="muted" style="margin-top:10px">Auto-refreshes every 60 seconds.</p>
    </div>`;
  setTimeout(() => { if (currentView() === "live") renderLive(v); }, 60000);
}

/* ------------------------------------------------------------------ */
/* Records + CSV                                                       */
/* ------------------------------------------------------------------ */

async function renderRecords(v) {
  const d = new Date();
  v.innerHTML = `
    <div class="panel">
      <h2>Attendance records</h2>
      <div class="toolbar">
        <input type="date" id="recDate" value="${d.toISOString().slice(0, 10)}">
        <button id="recLoad">Load</button>
        <button class="secondary" id="recCsv">Export CSV</button>
      </div>
      <div id="recTable"></div>
    </div>`;

  const load = async () => {
    const dt = new Date($("#recDate").value + "T12:00:00");
    const [from, to] = localDayRange(dt);
    try {
      const [records, employees] = await Promise.all([
        fetchAttendance(from, to),
        fetchEmployees(),
      ]);
      const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
      const rows = records.map((r) => {
        const emp = byId[r.employee_id];
        return {
          Name: emp?.full_name || r.employee_id,
          Email: emp?.email || "—",
          Type: r.check_type.toUpperCase(),
          Mode: r.mode ? r.mode.toUpperCase() : "—",
          Time: new Date(r.checked_at).toLocaleString(),
          Distance: r.distance_m != null ? Math.round(r.distance_m) + " m" : "—",
          Accuracy: r.gps_accuracy != null ? Math.round(r.gps_accuracy) + " m" : "—",
          Biometric: r.biometric_verified ? "yes" : "no",
          Status: r.status,
          Note: r.note || "",
        };
      });
      window.__csvRows = rows;
      $("#recTable").innerHTML = rows.length ? `
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Mode</th><th>Time</th><th>Distance</th><th>GPS acc.</th><th>Bio</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${esc(r.Name)}</td>
            <td><span class="badge ${r.Type === "IN" ? "in" : "out"}">${r.Type}</span></td>
            <td><span class="badge ${r.Mode === "OUTSIDE" ? "out" : "in"}">${r.Mode}</span></td>
            <td>${esc(r.Time)}</td>
            <td class="muted">${esc(r.Distance)}</td>
            <td class="muted">${esc(r.Accuracy)}</td>
            <td class="muted">${esc(r.Biometric)}</td>
            <td class="muted">${esc(r.Status)}</td>
            <td class="muted">${esc(r.Note)}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<div class="empty">No records for this date.</div>`;
    } catch (e) {
      $("#recTable").innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    }
  };

  $("#recLoad").addEventListener("click", load);
  $("#recCsv").addEventListener("click", () => {
    const rows = window.__csvRows || [];
    if (!rows.length) return;
    const header = Object.keys(rows[0]);
    const csv = [header, ...rows.map((r) => header.map((h) => r[h]))]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${$("#recDate").value}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  load();
}

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

async function renderOverrides(v) {
  v.innerHTML = `
    <div class="panel">
      <h2>Manual override</h2>
      <p class="muted" style="margin-bottom:12px">Use when GPS failed or an employee
      forgot to check in/out. The record is marked <b>overridden</b> and carries the
      note below.</p>
      <form id="ovForm">
        <div><label>Employee email</label><input id="ovEmail" type="email" required></div>
        <div><label>Type</label>
          <select id="ovType"><option value="in">Time In</option><option value="out">Time Out</option></select>
        </div>
        <div><label>Date &amp; time</label><input id="ovWhen" type="datetime-local" required></div>
        <div><label>Note</label><input id="ovNote" placeholder="e.g. GPS failure"></div>
        <div class="form-actions"><button type="submit">Record override</button></div>
      </form>
      <div id="ovMsg" style="margin-top:10px"></div>
    </div>`;

  $("#ovForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = $("#ovMsg");
    try {
      await rpc("admin_override", {
        p_employee_email: $("#ovEmail").value.trim(),
        p_check_type: $("#ovType").value,
        p_checked_at: new Date($("#ovWhen").value).toISOString(),
        p_note: $("#ovNote").value.trim(),
      });
      box.className = "msg ok";
      box.textContent = "Override recorded.";
      $("#ovEmail").value = ""; $("#ovNote").value = "";
    } catch (err) {
      box.className = "msg err";
      box.textContent = err.message || "Override failed.";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function renderSettings(v) {
  const s = await fetchSettings();

  const fields = [
    { key: "school_location", label: "School location (lat, lng)", type: "loc" },
    { key: "check_radius_m", label: "Check-in radius (meters)", type: "num" },
    { key: "max_gps_accuracy_m", label: "Max GPS accuracy (meters)", type: "num" },
    { key: "enforce_work_hours", label: "Enforce work hours", type: "bool" },
    { key: "work_start", label: "Work start", type: "time" },
    { key: "work_end", label: "Work end", type: "time" },
    { key: "biometric_required", label: "Require biometric (server flag)", type: "bool" },
  ];

  v.innerHTML = `
    <div class="panel">
      <h2>Rules &amp; settings</h2>
      <p class="muted" style="margin-bottom:12px">Changes apply immediately — no app
      update needed.</p>
      <form id="setForm" class="grid2">
        ${fields.map((f) => fieldHtml(s, f)).join("")}
        <div class="form-actions"><button type="submit">Save settings</button></div>
      </form>
      <div id="setMsg" style="margin-top:10px"></div>
    </div>`;

  $("#setForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = $("#setMsg");
    const values = {};
    for (const f of fields) {
      values[f.key] = readField(f);
    }
    try {
      for (const [key, val] of Object.entries(values)) {
        await rpc("admin_update_setting", { p_key: key, p_value: val });
      }
      box.className = "msg ok";
      box.textContent = "Settings saved.";
    } catch (err) {
      box.className = "msg err";
      box.textContent = err.message || "Failed to save settings.";
    }
  });
}

function fieldHtml(s, f) {
  const id = "set-" + f.key;
  let input = "";
  const val = s[f.key];
  if (f.type === "loc") {
    const lat = val?.lat ?? "";
    const lng = val?.lng ?? "";
    input = `<div><label>Latitude</label><input id="${id}-lat" type="number" step="any" value="${esc(lat)}">
      <label>Longitude</label><input id="${id}-lng" type="number" step="any" value="${esc(lng)}"></div>`;
  } else if (f.type === "bool") {
    input = `<label style="display:flex;align-items:center;gap:8px;color:var(--text);margin-top:6px">
      <input id="${id}" type="checkbox" style="width:auto" ${val ? "checked" : ""}> ${esc(f.label)}</label>`;
  } else if (f.type === "time") {
    input = `<input id="${id}" type="time" value="${esc(String(val ?? "08:00"))}">`;
  } else {
    input = `<input id="${id}" type="number" step="any" value="${esc(val ?? "")}">`;
  }
  const wrap = f.type === "bool"
    ? input
    : `<div><label>${esc(f.label)}</label>${input}</div>`;
  return wrap;
}

function readField(f) {
  const id = "set-" + f.key;
  if (f.type === "loc") {
    return {
      lat: parseFloat($("#" + id + "-lat").value) || 0,
      lng: parseFloat($("#" + id + "-lng").value) || 0,
    };
  }
  if (f.type === "bool") return $("#" + id).checked;
  if (f.type === "time") return $("#" + id).value || null;
  return parseFloat($("#" + id).value) || 0;
}

function flash(v, msg, isError) {
  const el = document.createElement("div");
  el.className = "msg " + (isError ? "err" : "ok");
  el.textContent = msg;
  v.prepend(el);
  setTimeout(() => el.remove(), 5000);
}