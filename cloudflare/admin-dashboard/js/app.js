// Cabiao SHS Attendance - Admin Dashboard (Cloudflare Workers API)
const $ = (sel) => document.querySelector(sel);
const view = () => document.getElementById("view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtDT = (iso) => new Date(iso).toLocaleString([], {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const fmtDate = (d) => d.toLocaleDateString([], {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});

let currentUser = null;
let autoRefreshTimer = null;

init();

async function init() {
  if (!window.ATTENDANCE_CONFIG?.API_URL) {
    view().innerHTML = `<div class="panel"><h2>Not configured</h2>
      <p>Open <b>js/config.js</b> and set your Cloudflare Workers API URL.</p></div>`;
    return;
  }

  // Check if already logged in
  const token = localStorage.getItem('attendance_token');
  if (token) {
    try {
      currentUser = JSON.parse(localStorage.getItem('attendance_user'));
      render();
      return;
    } catch {
      localStorage.removeItem('attendance_token');
      localStorage.removeItem('attendance_user');
    }
  }

  renderLogin();
}

/* ------------------------------------------------------------------ */
/* Routing / shell                                                     */
/* ------------------------------------------------------------------ */

const VIEWS = ["dashboard", "accounts", "records", "overrides", "settings"];

function currentView() {
  const h = window.location.hash.replace(/^#\//, "");
  return VIEWS.includes(h) ? h : "dashboard";
}

async function render() {
  if (!currentUser) { renderLogin(); return; }

  $("#header").hidden = false;
  $("#userLabel").textContent = `${currentUser.full_name} (${currentUser.role})`;
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === currentView());
  });

  const v = view();
  v.innerHTML = "";
  try {
    switch (currentView()) {
      case "accounts": await renderAccounts(v); break;
      case "records": await renderRecords(v); break;
      case "overrides": await renderOverrides(v); break;
      case "settings": await renderSettings(v); break;
      default: await renderDashboard(v);
    }
  } catch (e) {
    v.innerHTML = `<div class="msg err">${esc(e?.message || e)}</div>`;
  }
}

function renderLogin() {
  $("#header").hidden = true;
  view().innerHTML = `
    <div class="login-wrap">
      <div class="panel">
        <h2>iAttend – CSHS Admin</h2>
        <form id="loginForm">
          <div><label>Employee ID (7 digits)</label><input type="text" id="loginId" required pattern="\\d{7}" maxlength="7" autocomplete="username"></div>
          <div class="form-actions"><button type="submit">LOG IN</button></div>
        </form>
        <div id="loginMsg" style="margin-top:10px"></div>
      </div>
    </div>`;
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const msg = $("#loginMsg");
    btn.disabled = true;
    msg.innerHTML = "";
    try {
      const user = await window.api.login($("#loginId").value);
      currentUser = user;
      localStorage.setItem('attendance_user', JSON.stringify(user));
      render();
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}

$("#logoutBtn").addEventListener("click", () => {
  window.api.clearToken();
  localStorage.removeItem('attendance_user');
  currentUser = null;
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  render();
});

window.addEventListener("hashchange", render);

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

async function renderDashboard(v) {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  const today = new Date();
  const dateBanner = `<div class="date-banner">${fmtDate(today)}</div>`;
  v.innerHTML = dateBanner + `<div class="empty">Loading...</div>`;

  const [status, employees, departments] = await Promise.all([
    window.api.getStatus(),
    window.api.getEmployees(),
    window.api.getDepartments(),
  ]);

  // Group by department
  const deptMap = new Map();
  departments.forEach(d => deptMap.set(d.id, { ...d, employees: [] }));

  const clockedIn = new Set();
  status.forEach(s => clockedIn.add(s.email));

  employees.forEach(emp => {
    const dept = deptMap.get(emp.department_id);
    if (dept) {
      dept.employees.push({
        ...emp,
        status: status.find(s => s.email === emp.email),
      });
    }
  });

  const clockedInCount = status.length;

  v.innerHTML = `<div class="date-banner"><span>${fmtDate(today)}</span><span class="logged-in-count">Logged-In: ${clockedInCount}</span></div>
    <div class="dept-cards" id="deptCards">
      <button class="dept-card all" data-dept="all">
        <div class="dept-name">All Departments</div>
        <div class="num">${clockedInCount}</div>
        <div class="lbl">Logged In</div>
      </button>
      ${departments.map(d => {
        const count = status.filter(s => {
          const emp = employees.find(e => e.email === s.email);
          return emp?.department_id === d.id;
        }).length;
        return `<button class="dept-card" data-dept="${d.id}">
          <div class="dept-name">${esc(d.name)}</div>
          <div class="num">${count}</div>
          <div class="lbl">Logged In</div>
        </button>`;
      }).join('')}
    </div>
    <div id="deptDetail"></div>
  `;

  // Department card click handlers
  document.querySelectorAll('.dept-card').forEach(card => {
    card.addEventListener('click', () => {
      const deptId = card.dataset.dept;
      renderDeptDetail(deptId, status, employees, departments);
    });
  });

  // Auto-refresh every 20 seconds
  autoRefreshTimer = setInterval(async () => {
    try {
      const newStatus = await window.api.getStatus();
      renderDeptDetail('all', newStatus, employees, departments);
    } catch (e) {
      console.error('Auto-refresh failed:', e);
    }
  }, 20000);
}

function renderDeptDetail(deptId, status, employees, departments) {
  const detail = document.getElementById('deptDetail');
  if (!detail) return;

  let filtered = status;
  if (deptId !== 'all') {
    filtered = status.filter(s => {
      const emp = employees.find(e => e.email === s.email);
      return emp?.department_id === deptId;
    });
  }

  if (filtered.length === 0) {
    detail.innerHTML = `<div class="panel"><div class="empty">No employees clocked in</div></div>`;
    return;
  }

  detail.innerHTML = `
    <div class="panel">
      <h2>${deptId === 'all' ? 'All Departments' : departments.find(d => d.id === deptId)?.name}</h2>
      <table>
        <thead><tr><th>Name</th><th>Time</th><th>Mode</th><th>Duration</th></tr></thead>
        <tbody>
          ${filtered.map(s => {
            const duration = Math.round((new Date() - new Date(s.checked_at)) / 60000);
            return `<tr>
              <td>${esc(s.full_name)}</td>
              <td>${fmtTime(s.checked_at)}</td>
              <td><span class="badge in">${s.mode}</span></td>
              <td>${duration} min</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

async function renderAccounts(v) {
  v.innerHTML = `<div class="empty">Loading...</div>`;
  const [employees, departments, positions, devices] = await Promise.all([
    window.api.getEmployees(),
    window.api.getDepartments(),
    window.api.getPositions(),
    window.api.getDevices(),
  ]);

  // Map devices to employees
  const deviceMap = {};
  devices.forEach(d => {
    if (d.is_active) {
      deviceMap[d.employee_id] = d;
    }
  });

  v.innerHTML = `
    <div class="panel">
      <h2>Employees (${employees.length})</h2>
      <div class="toolbar">
        <button id="addEmpBtn">+ Add Employee</button>
        <button id="bulkRegBtn" style="background:var(--orange)">+ Bulk Register</button>
        <button id="downloadTemplateBtn" class="secondary">Download Template</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Department</th><th>Device</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${employees.map(e => {
            const device = deviceMap[e.id];
            const deviceInfo = device 
              ? `<span class="dev-chip" title="${esc(device.android_id)}">${esc(device.device_name || device.android_id.slice(0, 12))}</span>`
              : '<span class="muted">No device</span>';
            return `<tr>
              <td>${esc(e.full_name)}</td>
              <td>${esc(e.employee_id || '-')}</td>
              <td><span class="badge ${e.role === 'admin' ? 'in' : 'off'}">${e.role}</span></td>
              <td>${esc(departments.find(d => d.id === e.department_id)?.name || '-')}</td>
              <td>${deviceInfo}</td>
              <td><span class="badge ${e.is_active ? 'in' : 'out'}">${e.is_active ? 'Active' : 'Disabled'}</span></td>
              <td>
                <button class="secondary act-icon edit-btn" title="Edit" data-id="${e.id}" data-name="${esc(e.full_name)}" data-email="${esc(e.email)}" data-eid="${esc(e.employee_id || '')}" data-role="${e.role}" data-dept="${e.department_id || ''}" data-pos="${e.position_id || ''}">&#9998;</button>
                <button class="danger act-icon delete-btn" title="Delete" data-id="${e.id}" data-name="${esc(e.full_name)}">&#10005;</button>
                <button class="secondary act-icon toggle-btn" title="${e.is_active ? 'Disable' : 'Enable'}" data-id="${e.id}">${e.is_active ? '&#10003;' : '&#10007;'}</button>
                ${device ? `<button class="danger act-icon unbind-btn" title="Unbind device" data-eid="${e.id}" data-aid="${esc(device.android_id)}">&#128274;</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="panel" id="addEmpPanel" style="display:none">
      <h2>Add Employee</h2>
      <form id="addEmpForm">
        <div><label>First Name *</label><input type="text" id="empFirstName" required></div>
        <div><label>Last Name</label><input type="text" id="empLastName"></div>
        <div><label>Email *</label><input type="email" id="empEmail" required></div>
        <div><label>Employee ID (7 digits) *</label><input type="text" id="empId" required pattern="\\d{7}" maxlength="7"></div>
        <div><label>Role</label><select id="empRole"><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
        <div><label>Department</label><select id="empDept">${departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
        <div><label>Position</label><select id="empPos">${positions.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="form-actions"><button type="submit">Save</button><button type="button" class="secondary" id="cancelEmpBtn">Cancel</button></div>
      </form>
      <div id="addEmpMsg" style="margin-top:10px"></div>
    </div>
    <div class="panel" id="bulkRegPanel" style="display:none">
      <h2>Bulk Register Employees</h2>
      <p class="muted" style="margin-bottom:12px">Upload a CSV file with employee data. Download the template first to see the required format.</p>
      <div class="toolbar">
        <input type="file" id="csvFileInput" accept=".csv,.xlsx,.xls" style="display:none">
        <button id="selectFileBtn">Select CSV File</button>
        <button id="uploadCsvBtn" class="secondary" disabled>Upload & Register</button>
      </div>
      <div id="selectedFile" style="margin:10px 0;font-size:13px;color:var(--muted)"></div>
      <div id="bulkRegMsg" style="margin-top:10px"></div>
      <div id="bulkRegResults" style="margin-top:10px"></div>
    </div>
  `;

  // Toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await window.api.toggleEmployee(btn.dataset.id);
        renderAccounts(v);
      } catch (e) {
        alert(e.message);
      }
    });
  });

  // Edit buttons
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = $('#addEmpPanel');
      panel.style.display = 'block';
      panel.querySelector('h2').textContent = 'Edit Employee';
      $('#empFirstName').value = btn.dataset.name.split(' ')[0] || '';
      $('#empLastName').value = btn.dataset.name.split(' ').slice(1).join(' ') || '';
      $('#empEmail').value = btn.dataset.email || '';
      $('#empId').value = btn.dataset.eid || '';
      $('#empRole').value = btn.dataset.role || 'employee';
      $('#empDept').value = btn.dataset.dept || '';
      $('#empPos').value = btn.dataset.pos || '';
      panel.dataset.editId = btn.dataset.id;
    });
  });

  // Delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete ${btn.dataset.name}? This cannot be undone.`)) return;
      try {
        await window.api.deleteEmployee(btn.dataset.id);
        renderAccounts(v);
      } catch (e) {
        alert(e.message);
      }
    });
  });

  // Unbind buttons
  document.querySelectorAll('.unbind-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Unbind device for this employee?`)) return;
      try {
        await window.api.request(`/api/admin/devices/unbind`, {
          method: 'POST',
          body: JSON.stringify({ android_id: btn.dataset.aid }),
        });
        renderAccounts(v);
      } catch (e) {
        alert(e.message);
      }
    });
  });

  // Add employee form
  $('#addEmpBtn').addEventListener('click', () => {
    $('#addEmpPanel').style.display = 'block';
  });
  $('#cancelEmpBtn').addEventListener('click', () => {
    const panel = $('#addEmpPanel');
    panel.style.display = 'none';
    panel.querySelector('h2').textContent = 'Add Employee';
    delete panel.dataset.editId;
  });
  $('#addEmpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#addEmpMsg');
    const panel = $('#addEmpPanel');
    const editId = panel.dataset.editId;
    try {
      const data = {
        first_name: $('#empFirstName').value,
        last_name: $('#empLastName').value,
        email: $('#empEmail').value,
        employee_id: $('#empId').value,
        role: $('#empRole').value,
        department_id: $('#empDept').value,
        position_id: $('#empPos').value,
      };
      if (editId) {
        await window.api.updateEmployee(editId, data);
        msg.innerHTML = `<div class="msg ok">Employee updated</div>`;
      } else {
        await window.api.createEmployee(data);
        msg.innerHTML = `<div class="msg ok">Employee created</div>`;
      }
      delete panel.dataset.editId;
      setTimeout(() => renderAccounts(v), 1000);
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });

  // Download template
  $('#downloadTemplateBtn').addEventListener('click', () => {
    const csv = 'email,employee_id,first_name,middle_name,last_name,role,department_id,position_id\nadmin@cabiao.test,1000001,Admin,,User,admin,,\njohn@cabiao.test,1000002,John,,Doe,employee,,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'iattend_employees_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Bulk registration
  $('#bulkRegBtn').addEventListener('click', () => {
    $('#bulkRegPanel').style.display = 'block';
    $('#addEmpPanel').style.display = 'none';
  });

  // File selection
  let selectedFile = null;
  $('#selectFileBtn').addEventListener('click', () => {
    $('#csvFileInput').click();
  });

  $('#csvFileInput').addEventListener('change', (e) => {
    selectedFile = e.target.files[0];
    if (selectedFile) {
      $('#selectedFile').textContent = `Selected: ${selectedFile.name}`;
      $('#uploadCsvBtn').disabled = false;
    }
  });

  // Upload and register
  $('#uploadCsvBtn').addEventListener('click', async () => {
    if (!selectedFile) return;

    const msg = $('#bulkRegMsg');
    const results = $('#bulkRegResults');
    msg.innerHTML = `<div class="msg ok">Processing...</div>`;
    results.innerHTML = '';

    try {
      const text = await selectedFile.text();
      const lines = text.split('\n').filter(l => l.trim());

      if (lines.length < 2) {
        msg.innerHTML = `<div class="msg err">CSV file is empty or has no data rows</div>`;
        return;
      }

      // Parse CSV (simple parser)
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const employees = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const emp = {};
        headers.forEach((h, idx) => {
          emp[h] = values[idx]?.trim() || '';
        });
        employees.push(emp);
      }

      // Send to API
      const response = await window.api.request('/api/admin/employees/bulk', {
        method: 'POST',
        body: JSON.stringify({ employees }),
      });

      msg.innerHTML = `<div class="msg ok">Processed ${response.total} employees: ${response.success} success, ${response.failed} failed</div>`;

      if (response.details.errors.length > 0) {
        results.innerHTML = `
          <div class="msg err">
            <strong>Errors:</strong>
            <ul style="margin:8px 0 0 16px">
              ${response.details.errors.map(e => `<li>Row ${e.row} (${esc(e.email)}): ${esc(e.error)}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      if (response.success > 0) {
        setTimeout(() => renderAccounts(v), 2000);
      }
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });

  // Simple CSV line parser (handles quoted values)
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

async function renderRecords(v) {
  const today = new Date().toISOString().split('T')[0];
  v.innerHTML = `<div class="empty">Loading...</div>`;

  const [records, employees] = await Promise.all([
    window.api.getAttendance(today, today),
    window.api.getEmployees(),
  ]);

  v.innerHTML = `
    <div class="panel">
      <h2>Attendance Records</h2>
      <div class="toolbar">
        <label>From</label><input type="date" id="recFrom" value="${today}">
        <label>To</label><input type="date" id="recTo" value="${today}">
        <button id="filterRecBtn">Filter</button>
        <button class="secondary" id="exportCsvBtn">Export CSV</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Date</th><th>IN</th><th>OUT</th><th>Mode</th><th>Duration</th></tr></thead>
        <tbody>
          ${records.map(r => {
            const emp = employees.find(e => e.id === r.employee_id);
            return `<tr>
              <td>${esc(emp?.full_name || r.employee_id)}</td>
              <td>${fmtDT(r.checked_at)}</td>
              <td>${r.check_type === 'in' ? fmtTime(r.checked_at) : '-'}</td>
              <td>${r.check_type === 'out' ? fmtTime(r.checked_at) : '-'}</td>
              <td><span class="badge ${r.check_type === 'in' ? 'in' : 'out'}">${r.mode}</span></td>
              <td>-</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Filter
  $('#filterRecBtn').addEventListener('click', async () => {
    const from = $('#recFrom').value;
    const to = $('#recTo').value;
    const newRecords = await window.api.getAttendance(from, to);
    // Re-render with new records
    renderRecords(v);
  });

  // CSV Export
  $('#exportCsvBtn').addEventListener('click', () => {
    const rows = [['Name', 'Date', 'Check Type', 'Time', 'Mode', 'Status']];
    records.forEach(r => {
      const emp = employees.find(e => e.id === r.employee_id);
      rows.push([
        emp?.full_name || r.employee_id,
        new Date(r.checked_at).toLocaleDateString(),
        r.check_type,
        fmtTime(r.checked_at),
        r.mode,
        r.status,
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${today}.csv`;
    a.click();
  });
}

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

async function renderOverrides(v) {
  const employees = await window.api.getEmployees();

  v.innerHTML = `
    <div class="panel">
      <h2>Manual Attendance Override</h2>
      <form id="overrideForm">
        <div><label>Employee Email *</label><select id="ovEmail" required>${employees.map(e => `<option value="${e.email}">${esc(e.full_name)} (${e.email})</option>`).join('')}</select></div>
        <div><label>Type *</label><select id="ovType" required><option value="in">Check IN</option><option value="out">Check OUT</option></select></div>
        <div><label>Date & Time *</label><input type="datetime-local" id="ovTime" required></div>
        <div><label>Note</label><input type="text" id="ovNote" placeholder="Reason for override"></div>
        <div class="form-actions"><button type="submit">Submit Override</button></div>
      </form>
      <div id="ovMsg" style="margin-top:10px"></div>
    </div>
  `;

  $('#overrideForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#ovMsg');
    try {
      await window.api.overrideAttendance({
        employee_email: $('#ovEmail').value,
        check_type: $('#ovType').value,
        checked_at: new Date($('#ovTime').value).toISOString(),
        note: $('#ovNote').value || 'Manual override',
      });
      msg.innerHTML = `<div class="msg ok">Override submitted</div>`;
      e.target.reset();
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function renderSettings(v) {
  const [rules, departments, positions] = await Promise.all([
    window.api.getRules(),
    window.api.getDepartments(),
    window.api.getPositions(),
  ]);

  v.innerHTML = `
    <div class="panel">
      <h2>Attendance Settings</h2>
      <form id="settingsForm">
        <div><label>School Latitude</label><input type="number" step="any" id="setLat" value="${rules.school_lat}"></div>
        <div><label>School Longitude</label><input type="number" step="any" id="setLng" value="${rules.school_lng}"></div>
        <div><label>Check Radius (m)</label><input type="number" id="setRadius" value="${rules.check_radius_m}"></div>
        <div><label>Max GPS Accuracy (m)</label><input type="number" id="setAccuracy" value="${rules.max_gps_accuracy_m}"></div>
        <div><label>Max Devices per Account</label><input type="number" id="setMaxDevices" value="${rules.max_devices_per_account}"></div>
        <div class="form-actions"><button type="submit">Save Settings</button></div>
      </form>
      <div id="setMsg" style="margin-top:10px"></div>
    </div>

    <div style="display:flex;gap:20px">
      <div class="panel" style="flex:1;margin-bottom:0">
        <h2>Departments (${departments.length})</h2>
        <div class="toolbar">
          <input type="text" id="newDeptName" placeholder="Department name" style="flex:1">
          <button id="addDeptBtn">Add</button>
        </div>
        <div id="deptList" style="margin-top:10px">
          ${departments.map(d => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="flex:1">${esc(d.name)}</span>
              <button class="secondary act-icon delete-dept-btn" title="Delete" data-id="${d.id}" data-name="${esc(d.name)}">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <div id="deptMsg" style="margin-top:10px"></div>
      </div>

      <div class="panel" style="flex:1;margin-bottom:0">
        <h2>Employee Types (${positions.length})</h2>
        <div class="toolbar">
          <input type="text" id="newPosName" placeholder="Position name" style="flex:1">
          <button id="addPosBtn">Add</button>
        </div>
        <div id="posList" style="margin-top:10px">
          ${positions.map(p => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="flex:1">${esc(p.name)}</span>
              <button class="secondary act-icon delete-pos-btn" title="Delete" data-id="${p.id}" data-name="${esc(p.name)}">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <div id="posMsg" style="margin-top:10px"></div>
      </div>
    </div>
  `;

  // Save attendance settings
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#setMsg');
    try {
      await window.api.updateSetting('school_location', {
        lat: parseFloat($('#setLat').value),
        lng: parseFloat($('#setLng').value),
      });
      await window.api.updateSetting('check_radius_m', parseInt($('#setRadius').value));
      await window.api.updateSetting('max_gps_accuracy_m', parseInt($('#setAccuracy').value));
      await window.api.updateSetting('max_devices_per_account', parseInt($('#setMaxDevices').value));
      msg.innerHTML = `<div class="msg ok">Settings saved</div>`;
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });

  // Add department
  $('#addDeptBtn').addEventListener('click', async () => {
    const name = $('#newDeptName').value.trim();
    if (!name) return;
    const msg = $('#deptMsg');
    try {
      await window.api.request('/api/admin/departments', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      msg.innerHTML = `<div class="msg ok">Added</div>`;
      setTimeout(() => renderSettings(v), 500);
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });

  // Delete department
  document.querySelectorAll('.delete-dept-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete department "${btn.dataset.name}"?`)) return;
      try {
        await window.api.request(`/api/admin/departments/${btn.dataset.id}`, { method: 'DELETE' });
        renderSettings(v);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Add position
  $('#addPosBtn').addEventListener('click', async () => {
    const name = $('#newPosName').value.trim();
    if (!name) return;
    const msg = $('#posMsg');
    try {
      await window.api.request('/api/admin/positions', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      msg.innerHTML = `<div class="msg ok">Added</div>`;
      setTimeout(() => renderSettings(v), 500);
    } catch (err) {
      msg.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });

  // Delete position
  document.querySelectorAll('.delete-pos-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete position "${btn.dataset.name}"?`)) return;
      try {
        await window.api.request(`/api/admin/positions/${btn.dataset.id}`, { method: 'DELETE' });
        renderSettings(v);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}
