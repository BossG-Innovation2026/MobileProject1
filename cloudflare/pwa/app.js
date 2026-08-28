// iAttend PWA - Main Application
const API_URL = 'https://iattend-api.305872.workers.dev';

// DOM Elements
const $ = (sel) => document.querySelector(sel);
const loginScreen = $('#loginScreen');
const mainScreen = $('#mainScreen');
const loginForm = $('#loginForm');
const loginBtn = $('#loginBtn');
const loginError = $('#loginError');
const logoutBtn = $('#logoutBtn');
const actionBtn = $('#actionBtn');
const statusBanner = $('#statusBanner');
const statusText = $('#statusText');
const statusTime = $('#statusTime');
const statusDetail = $('#statusDetail');
const locationInfo = $('#locationInfo');
const distanceInfo = $('#distanceInfo');
const modeInfo = $('#modeInfo');
const gpsSignal = $('#gpsSignal');
const durationDisplay = $('#durationDisplay');
const durationTime = $('#durationTime');
const historyList = $('#historyList');
const offlineBanner = $('#offlineBanner');
const syncIndicator = $('#syncIndicator');
const pendingCountEl = $('#pendingCount');
const pendingCountEl = $('#pendingCount');
const userLabel = $('#userLabel');

const deviceInfo = $('#deviceInfo');
const deviceActions = $('#deviceActions');
const unbindBtn = $('#unbindBtn');

// Modal elements
const outsideModal = $('#outsideModal');
const closeModalBtn = $('#closeModal');
const outsideReason = $('#outsideReason');
const outsideShortName = $('#outsideShortName');
const confirmOutsideBtn = $('#confirmOutsideBtn');

// State
let currentUser = null;
let token = null;
let watchId = null;
let currentLat = null;
let currentLng = null;
let gpsAccuracy = null;
let lastCheckIn = null;
let durationInterval = null;
let db = null;
let isInsideGeofence = false;
let schoolLat = null;
let schoolLng = null;
let checkRadius = 300;
let pendingCheckinData = null;

// Initialize
init();

async function init() {
  // Open IndexedDB
  await openDB();

  // Check for saved session
  token = localStorage.getItem('iattend_token');
  currentUser = JSON.parse(localStorage.getItem('iattend_user'));

  if (token === 'offline' && currentUser) {
    showMainScreen();
  } else if (token && currentUser) {
    showMainScreen();
  }

  // Online/offline events
  window.addEventListener('online', () => {
    offlineBanner.classList.remove('show');
    renderOfflineLogin();
    syncOfflineData();
  });
  window.addEventListener('offline', () => {
    offlineBanner.classList.add('show');
    renderOfflineLogin();
  });

  // Check initial online status
  if (!navigator.onLine) {
    offlineBanner.classList.add('show');
    renderOfflineLogin();
  }

  // Tab navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      $(`#${btn.dataset.tab}`).classList.add('active');

      if (btn.dataset.tab === 'historyTab') {
        loadHistory();
      }
    });
  });
}

// IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('iattend_db', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('pending_checkins')) {
        database.createObjectStore('pending_checkins', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('attendance_cache')) {
        database.createObjectStore('attendance_cache', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('offline_users')) {
        database.createObjectStore('offline_users', { keyPath: 'employee_id' });
      }
    };
  });
}

function saveOfflineUser(user) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offline_users', 'readwrite');
    tx.objectStore('offline_users').put({
      employee_id: user.employee_id,
      full_name: user.full_name,
      id: user.id,
      email: user.email,
      role: user.role,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getOfflineUsers() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offline_users', 'readonly');
    const request = tx.objectStore('offline_users').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function renderOfflineLogin() {
  const offlinePanel = $('#offlineLogin');
  const offlineList = $('#offlineIdList');
  if (!offlinePanel || !offlineList) return;

  if (navigator.onLine) {
    offlinePanel.style.display = 'none';
    return;
  }

  getOfflineUsers().then((users) => {
    if (users.length === 0) {
      offlinePanel.style.display = 'none';
      return;
    }
    offlinePanel.style.display = 'block';
    offlineList.innerHTML = users.map(u =>
      `<button class="offline-user-btn" data-empid="${u.employee_id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);border-radius:8px;background:var(--card);cursor:pointer;text-align:left;font:inherit">
        <span style="flex:1"><b>${u.employee_id}</b> — ${esc(u.full_name)}</span>
        <span style="font-size:11px;color:var(--muted)">OFFLINE</span>
      </button>`
    ).join('');

    offlineList.querySelectorAll('.offline-user-btn').forEach(btn => {
      btn.addEventListener('click', () => offlineLogin(btn.dataset.empid));
    });
  });
}

async function offlineLogin(empId) {
  const users = await getOfflineUsers();
  const user = users.find(u => u.employee_id === empId);
  if (!user) return;

  currentUser = user;
  token = 'offline';
  localStorage.setItem('iattend_token', token);
  localStorage.setItem('iattend_user', JSON.stringify(currentUser));

  showMainScreen();
}

function savePendingCheckin(data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readwrite');
    tx.objectStore('pending_checkins').add(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getPendingCheckins() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readonly');
    const request = tx.objectStore('pending_checkins').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearPendingCheckins() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readwrite');
    tx.objectStore('pending_checkins').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function saveAttendanceCache(records) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance_cache', 'readwrite');
    const store = tx.objectStore('attendance_cache');
    store.clear();
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAttendanceCache() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance_cache', 'readonly');
    const request = tx.objectStore('attendance_cache').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Sync offline data
async function syncOfflineData() {
  const pending = await getPendingCheckins();
  if (pending.length === 0) return;

  if (token === 'offline' && currentUser) {
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ employee_id: currentUser.employee_id }),
      });
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('iattend_token', token);
      localStorage.setItem('iattend_user', JSON.stringify(currentUser));
    } catch (e) {
      console.error('Re-auth failed:', e);
      return;
    }
  }

  pendingCountEl.textContent = `(${pending.length} pending)`;
  offlineBanner.classList.add('show');
  syncIndicator.classList.add('show');

  for (const item of pending) {
    try {
      await apiRequest(item.type === 'in' ? '/api/attendance/check-in' : '/api/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify(item.data),
      });
    } catch (e) {
      console.error('Sync failed for item:', e);
      syncIndicator.classList.remove('show');
      return;
    }
  }

  await clearPendingCheckins();
  syncIndicator.classList.remove('show');
  offlineBanner.classList.remove('show');
  refreshStatus();
  updatePendingCount();
}

// Update pending count display
function updatePendingCount() {
  getPendingCheckins().then((pending) => {
    const count = pending.length;
    if (count > 0) {
      pendingCountEl.textContent = `(${count} pending)`;
      offlineBanner.classList.add('show');
    } else {
      pendingCountEl.textContent = '';
      offlineBanner.classList.remove('show');
    }
  });
}

// IndexedDB operations
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('iattend_db', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('pending_checkins')) {
        database.createObjectStore('pending_checkins', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('attendance_cache')) {
        database.createObjectStore('attendance_cache', { keyPath: 'id' });
      }
    };
  });
}

function savePendingCheckin(data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readwrite');
    tx.objectStore('pending_checkins').add(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getPendingCheckins() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readonly');
    const request = tx.objectStore('pending_checkins').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearPendingCheckins() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_checkins', 'readwrite');
    tx.objectStore('pending_checkins').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// API Request
async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const empId = $('#employeeId').value;
  loginBtn.disabled = true;
  loginError.classList.remove('show');

  if (!navigator.onLine) {
    loginError.textContent = 'No internet. Use offline login below.';
    loginError.classList.add('show');
    loginBtn.disabled = false;
    return;
  }

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId }),
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('iattend_token', token);
    localStorage.setItem('iattend_user', JSON.stringify(currentUser));

    await saveOfflineUser(data.user);
    await showPinBeforeAction();
    showMainScreen();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.add('show');
  } finally {
    loginBtn.disabled = false;
  }
});

// Logout
logoutBtn.addEventListener('click', () => {
  token = null;
  currentUser = null;
  localStorage.removeItem('iattend_token');
  localStorage.removeItem('iattend_user');
  if (watchId) navigator.geolocation.clearWatch(watchId);
  if (durationInterval) clearInterval(durationInterval);
  mainScreen.classList.remove('active');
  loginScreen.classList.add('active');
});

// Show main screen
function showMainScreen() {
  loginScreen.classList.remove('active');
  mainScreen.classList.add('active');
  userLabel.textContent = currentUser.full_name;
  startGPS();

  if (token === 'offline') {
    statusText.textContent = 'Offline Mode';
    statusDetail.textContent = 'Check-ins will sync when online';
    statusTime.textContent = '--:--';
    deviceInfo.textContent = 'Offline — binding check skipped';
    deviceInfo.style.color = 'var(--muted)';
    deviceActions.style.display = 'none';
    updatePendingCount();
  } else {
    refreshStatus();
    checkDeviceBinding();
  }
}

// Start GPS tracking
function startGPS() {
  if (!navigator.geolocation) {
    locationInfo.textContent = 'GPS not supported';
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      gpsAccuracy = pos.coords.accuracy;

      updateGPSIndicator();
      updateLocationInfo();
      updateGeofenceStatus();
      updateButtonText();
      actionBtn.disabled = false;
    },
    (err) => {
      console.error('GPS error:', err);
      locationInfo.textContent = 'GPS error: ' + err.message;
      gpsSignal.className = 'gps-signal poor';
      gpsSignal.querySelector('.text').textContent = 'No GPS';
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 30000,
    }
  );
}

function updateGPSIndicator() {
  if (gpsAccuracy <= 10) {
    gpsSignal.className = 'gps-signal good';
    gpsSignal.querySelector('.text').textContent = `GPS: ${Math.round(gpsAccuracy)}m`;
  } else if (gpsAccuracy <= 30) {
    gpsSignal.className = 'gps-signal medium';
    gpsSignal.querySelector('.text').textContent = `GPS: ${Math.round(gpsAccuracy)}m`;
  } else {
    gpsSignal.className = 'gps-signal poor';
    gpsSignal.querySelector('.text').textContent = `GPS: ${Math.round(gpsAccuracy)}m`;
  }
}

function updateLocationInfo() {
  if (currentLat && currentLng) {
    locationInfo.textContent = `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`;
  }
}

// Update button text based on geofence status
function updateButtonText() {
  const isCheckedIn = lastCheckIn !== null;
  
  if (isCheckedIn) {
    actionBtn.textContent = isInsideGeofence ? 'LOG OUT' : 'CHECK OUT';
  } else {
    actionBtn.textContent = isInsideGeofence ? 'LOG IN' : 'CHECK IN';
  }

  // Update mode display
  if (currentLat && currentLng && schoolLat && schoolLng) {
    const dist = haversineM(currentLat, currentLng, schoolLat, schoolLng);
    if (dist <= checkRadius) {
      modeInfo.textContent = 'Inside geofence';
      modeInfo.style.color = 'var(--green)';
      distanceInfo.textContent = `${Math.round(dist)}m from school`;
    } else {
      modeInfo.textContent = 'Outside geofence';
      modeInfo.style.color = 'var(--orange)';
      distanceInfo.textContent = `${Math.round(dist)}m from school`;
    }
  }
}

// Haversine distance
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Check device binding
async function checkDeviceBinding() {
  try {
    const deviceId = await getDeviceId();
    const result = await apiRequest('/api/auth/device-owner', {
      method: 'POST',
      body: JSON.stringify({ android_id: deviceId }),
    });

    if (result.bound) {
      if (result.employee_id === currentUser.id) {
        deviceInfo.textContent = 'Bound to your account';
        deviceInfo.style.color = 'var(--green)';
        deviceActions.style.display = 'block';
        unbindBtn.style.display = 'none'; // Users can't unbind themselves
      } else {
        deviceInfo.textContent = `Bound to: ${result.full_name}`;
        deviceInfo.style.color = 'var(--red)';
        deviceActions.style.display = 'none';
        // Disable check-in completely
        actionBtn.disabled = true;
        actionBtn.textContent = 'DEVICE LOCKED';
        actionBtn.style.background = 'var(--red)';
        statusText.textContent = 'Device bound to another employee';
        statusTime.textContent = 'CONTACT ADMIN';
        statusDetail.textContent = 'This device is registered to another user';
      }
    } else {
      // Check if user already has a different device
      const devices = await apiRequest('/api/admin/devices');
      const userDevice = devices.find(d => d.employee_id === currentUser.id && d.is_active);

      if (userDevice) {
        // User has another device - show warning but allow (will fail on server)
        deviceInfo.textContent = `Your device: ${userDevice.android_id.slice(0, 16)}...`;
        deviceInfo.style.color = 'var(--orange)';
        deviceActions.style.display = 'block';
        statusText.textContent = 'Different device detected';
        statusDetail.textContent = 'Check-in will fail. Contact admin to unbind your old device.';
      } else {
        deviceInfo.textContent = 'New device (will bind on first check-in)';
        deviceInfo.style.color = 'var(--orange)';
        deviceActions.style.display = 'none';
      }
    }
  } catch (err) {
    deviceInfo.textContent = 'Unable to check binding';
    deviceInfo.style.color = 'var(--muted)';
  }
}

// Unbind device
unbindBtn.addEventListener('click', async () => {
  if (!confirm('Unbind this device? You will need to rebind on next check-in from this device.')) return;

  try {
    const deviceId = await getDeviceId();
    await apiRequest('/api/admin/devices/unbind', {
      method: 'POST',
      body: JSON.stringify({ android_id: deviceId }),
    });
    deviceInfo.textContent = 'Device unbound';
    deviceInfo.style.color = 'var(--orange)';
    deviceActions.style.display = 'none';
    actionBtn.disabled = false;
    actionBtn.textContent = 'CHECK IN';
    actionBtn.style.background = 'var(--green)';
    alert('Device unbound. You can now check in from any device.');
  } catch (err) {
    alert('Unbind failed: ' + err.message);
  }
});

// Refresh status
async function refreshStatus() {
  try {
    // Get rules
    const rules = await apiRequest('/api/attendance/rules');
    schoolLat = rules.school_lat;
    schoolLng = rules.school_lng;
    checkRadius = rules.check_radius_m;

    // Get today's attendance
    const records = await apiRequest('/api/attendance/today');

    // Cache for offline
    await saveAttendanceCache(records);

    // Determine current status
    const lastRecord = records[records.length - 1];
    const isCheckedIn = lastRecord && lastRecord.check_type === 'in';

    // Calculate geofence status
    updateGeofenceStatus();

    if (isCheckedIn) {
      lastCheckIn = new Date(lastRecord.checked_at);
      statusBanner.className = 'status-banner clocked-in';
      statusText.textContent = 'Checked In';
      statusTime.textContent = lastCheckIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusDetail.textContent = `${lastRecord.mode} mode`;
      
      // Button text based on current geofence status
      if (isInsideGeofence) {
        actionBtn.textContent = 'LOG OUT';
      } else {
        actionBtn.textContent = 'CHECK OUT';
      }
      actionBtn.className = 'action-btn checkout';
      startDurationTimer();
    } else {
      lastCheckIn = null;
      statusBanner.className = 'status-banner clocked-out';
      statusText.textContent = 'Not Checked In';
      statusTime.textContent = '--:--';
      statusDetail.textContent = '';
      
      // Button text based on current geofence status
      if (isInsideGeofence) {
        actionBtn.textContent = 'LOG IN';
      } else {
        actionBtn.textContent = 'CHECK IN';
      }
      actionBtn.className = 'action-btn checkin';
      durationDisplay.style.display = 'none';
      if (durationInterval) clearInterval(durationInterval);
    }

    // Update distance if GPS available
    if (currentLat && currentLng) {
      const dist = haversineM(currentLat, currentLng, schoolLat, schoolLng);
      distanceInfo.textContent = `${Math.round(dist)}m from school`;

      if (dist <= checkRadius) {
        modeInfo.textContent = 'Inside geofence';
        modeInfo.style.color = 'var(--green)';
      } else {
        modeInfo.textContent = 'Outside geofence';
        modeInfo.style.color = 'var(--orange)';
      }
    }

  } catch (err) {
    // Offline - try cache
    const cached = await getAttendanceCache();
    if (cached.length > 0) {
      const lastRecord = cached[cached.length - 1];
      const isCheckedIn = lastRecord && lastRecord.check_type === 'in';
      if (isCheckedIn) {
        statusBanner.className = 'status-banner clocked-in';
        statusText.textContent = 'Checked In (cached)';
        statusTime.textContent = new Date(lastRecord.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (isInsideGeofence) {
          actionBtn.textContent = 'LOG OUT';
        } else {
          actionBtn.textContent = 'CHECK OUT';
        }
        actionBtn.className = 'action-btn checkout';
      }
    }
    console.error('Status refresh failed:', err);
  }
}

// Update geofence status
function updateGeofenceStatus() {
  if (currentLat && currentLng && schoolLat && schoolLng) {
    const dist = haversineM(currentLat, currentLng, schoolLat, schoolLng);
    isInsideGeofence = dist <= checkRadius;
  }
}

// Duration timer
function startDurationTimer() {
  if (durationInterval) clearInterval(durationInterval);
  durationDisplay.style.display = 'block';

  function update() {
    if (!lastCheckIn) return;
    const diff = Date.now() - lastCheckIn.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    durationTime.textContent = `${hours}:${mins.toString().padStart(2, '0')}`;
  }

  update();
  durationInterval = setInterval(update, 60000);
}

// Check in/out
actionBtn.addEventListener('click', async () => {
  if (!currentLat || !currentLng) {
    alert('Waiting for GPS fix...');
    return;
  }

  const actionText = actionBtn.textContent.trim();
  const isCheckIn = actionText === 'LOG IN' || actionText === 'CHECK IN';
  const isCheckOut = actionText === 'LOG OUT' || actionText === 'CHECK OUT';

  if (!isCheckIn && !isCheckOut) return;

  const verified = await showPinBeforeAction();
  if (!verified) {
    alert('Verification failed. Access denied.');
    return;
  }

  if (token === 'offline' || !navigator.onLine) {
    await performCheckin({
      lat: currentLat,
      lng: currentLng,
      accuracy: gpsAccuracy,
      android_id: await getDeviceId(),
      device_name: navigator.userAgent.slice(0, 50),
      biometric: true,
    }, isCheckIn);
    return;
  }

  if (!isInsideGeofence && isCheckIn) {
    pendingCheckinData = {
      lat: currentLat,
      lng: currentLng,
      accuracy: gpsAccuracy,
      android_id: await getDeviceId(),
      device_name: navigator.userAgent.slice(0, 50),
      biometric: true,
    };
    outsideModal.style.display = 'flex';
    outsideReason.value = '';
    outsideShortName.value = '';
    outsideReason.focus();
    return;
  }

  await performCheckin({
    lat: currentLat,
    lng: currentLng,
    accuracy: gpsAccuracy,
    android_id: await getDeviceId(),
    device_name: navigator.userAgent.slice(0, 50),
    biometric: true,
  }, isCheckIn);
});

// Confirm outside geofence check-in
confirmOutsideBtn.addEventListener('click', async () => {
  const reason = outsideReason.value.trim();
  const shortName = outsideShortName.value.trim().toUpperCase();

  if (!reason) {
    alert('Please enter a location/reason');
    return;
  }

  if (!shortName) {
    alert('Please enter a short name for display');
    return;
  }

  // Add note to payload
  pendingCheckinData.note = `${shortName} - ${reason}`;

  outsideModal.style.display = 'none';
  await performCheckin(pendingCheckinData, true);
});

// Close modal
closeModalBtn.addEventListener('click', () => {
  outsideModal.style.display = 'none';
  pendingCheckinData = null;
});

outsideModal.addEventListener('click', (e) => {
  if (e.target === outsideModal) {
    outsideModal.style.display = 'none';
    pendingCheckinData = null;
  }
});

// Perform check-in/out
async function performCheckin(payload, isCheckIn) {
  const endpoint = isCheckIn ? '/api/attendance/check-in' : '/api/attendance/check-out';

  actionBtn.disabled = true;

  try {
    if (token === 'offline' || !navigator.onLine) {
      await savePendingCheckin({
        type: isCheckIn ? 'in' : 'out',
        data: payload,
        timestamp: new Date().toISOString(),
      });
    } else {
      await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    if (token !== 'offline') {
      await refreshStatus();
    } else {
      updatePendingCount();
    }
    loadHistory();
  } catch (err) {
    alert(err.message);
  } finally {
    actionBtn.disabled = false;
    pendingCheckinData = null;
  }
}

// Device binding - browser fingerprint
async function getDeviceId() {
  // Check IndexedDB first (more persistent than localStorage)
  let id = await getFromDB('device_id');

  if (!id) {
    // Generate stable fingerprint from browser characteristics
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.colorDepth,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform,
    ];

    // Create hash from components
    const data = components.join('|||');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    id = 'web_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);

    // Save to IndexedDB
    await saveToDB('device_id', id);
  }

  return id;
}

// PIN verification
function hashPin(pin, salt) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
    .then(km => crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, 256))
    .then(b => Array.from(new Uint8Array(b)));
}

async function getPinSalt() { return getFromDB('pin_salt'); }
async function getPinHash() { return getFromDB('pin_hash'); }

async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt);
  await saveToDB('pin_salt', JSON.stringify(Array.from(salt)));
  await saveToDB('pin_hash', JSON.stringify(hash));
}

async function verifyPin(pin) {
  const saltRaw = await getPinSalt();
  const hashRaw = await getPinHash();
  if (!saltRaw || !hashRaw) return false;
  const salt = new Uint8Array(JSON.parse(saltRaw));
  const expected = JSON.parse(hashRaw);
  const actual = await hashPin(pin, salt);
  if (actual.length !== expected.length) return false;
  return actual.every((v, i) => v === expected[i]);
}

// PIN overlay
let pinResolve = null;
let pinAttempts = 0;

function openPinOverlay(title, subtitle) {
  return new Promise(resolve => {
    pinResolve = resolve;
    pinAttempts = 0;
    const overlay = $('#pinOverlay');
    const dots = overlay.querySelectorAll('.pin-dot');
    const titleEl = $('#pinTitle');
    const subEl = $('#pinSubtitle');
    titleEl.textContent = title;
    subEl.textContent = subtitle || 'Confirm your identity to proceed';
    dots.forEach(d => d.style.background = 'var(--border)');
    overlay.style.display = 'flex';
    overlay._resolve = resolve;
    overlay._resolveSetPin = null;
  });
}

function closePinOverlay(result) {
  const overlay = $('#pinOverlay');
  overlay.style.display = 'none';
  if (pinResolve) { pinResolve(result); pinResolve = null; }
}

function initPinKeypad() {
  const overlay = $('#pinOverlay');
  overlay.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', async () => {
      const digit = btn.dataset.digit;
      const dots = overlay.querySelectorAll('.pin-dot');
      const current = Array.from(overlay.querySelectorAll('.pin-dot')).filter(d => d.style.background === 'var(--orange)').length;
      if (digit === 'backspace') {
        if (current > 0) {
          const entered = overlay._entered || [];
          entered.pop();
          overlay._entered = entered;
          dots[entered.length].style.background = 'var(--border)';
        }
        return;
      }
      if (!digit || current >= 4) return;
      overlay._entered = overlay._entered || [];
      overlay._entered.push(digit);
      dots[current].style.background = 'var(--orange)';
      if (overlay._entered.length === 4) {
        const pin = overlay._entered.join('');
        overlay._entered = [];
        const title = $('#pinTitle').textContent;
        if (title === 'Set PIN') {
          await setPin(pin);
          closePinOverlay(true);
          return;
        }
        const ok = await verifyPin(pin);
        if (ok) {
          dots.forEach(d => d.style.background = 'var(--green)');
          setTimeout(() => closePinOverlay(true), 300);
        } else {
          pinAttempts++;
          dots.forEach(d => { d.style.background = 'var(--red)'; setTimeout(() => d.style.background = 'var(--border)', 400); });
          if (pinAttempts >= 3) {
            setTimeout(() => { alert('Too many attempts.'); closePinOverlay(false); }, 600);
            return;
          }
          setTimeout(() => {
            overlay.querySelectorAll('.pin-dot').forEach(d => d.style.background = 'var(--border)');
            overlay._entered = [];
          }, 600);
        }
      }
    });
  });
}

function showPinBeforeAction() {
  return new Promise(async (resolve) => {
    const hasHash = await getPinHash();
    if (!hasHash) {
      const ok = await openPinOverlay('Set PIN', 'Create a 4-digit PIN for quick login');
      if (ok) {
        const overlay = $('#pinOverlay');
        overlay.querySelectorAll('.pin-dot').forEach(d => d.style.background = 'var(--border)');
        let entered = [];
        const dots = overlay.querySelectorAll('.pin-dot');
        const waitForPin = () => new Promise(res => {
          let attemptResolve = null;
          overlay.addEventListener('click', function h() {
            const btn = event.target.closest('.pin-key');
            if (!btn) return;
            const d = btn.dataset.digit;
            if (d === 'backspace') {
              if (entered.length > 0) { entered.pop(); dots[entered.length].style.background = 'var(--border)'; }
              return;
            }
            if (!d || entered.length >= 4) return;
            entered.push(d);
            dots[entered.length - 1].style.background = 'var(--orange)';
            if (entered.length === 4) {
              overlay.removeEventListener('click', h);
              res(entered.join(''));
            }
          });
        });
        const pin = await waitForPin();
        await setPin(pin);
        overlay.style.display = 'none';
        resolve(true);
      } else {
        resolve(false);
      }
    } else {
      const result = await openPinOverlay('Enter PIN', '');
      resolve(result);
    }
  });
}

initPinKeypad();

function saveToDB(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance_cache', 'readwrite');
    tx.objectStore('attendance_cache').put({ id: key, value: value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getFromDB(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance_cache', 'readonly');
    const request = tx.objectStore('attendance_cache').get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

// Load history
async function loadHistory() {
  try {
    const records = await apiRequest('/api/attendance/today');
    renderHistory(records);
  } catch (err) {
    // Use cache
    const cached = await getAttendanceCache();
    renderHistory(cached);
  }
}

function renderHistory(records) {
  if (!records || records.length === 0) {
    historyList.innerHTML = '<div class="pull-hint">No records today</div>';
    return;
  }

  historyList.innerHTML = records.map(r => {
    const time = new Date(r.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mode = r.mode || 'inside';
    return `
      <div class="history-item">
        <div class="type-badge ${r.check_type}">${r.check_type === 'in' ? 'IN' : 'OUT'}</div>
        <div class="details">
          <div class="time">${time}</div>
          <div class="meta">${mode} mode</div>
        </div>
        <span class="mode">${mode}</span>
      </div>
    `;
  }).join('');
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.error('SW registration failed:', err));
}
