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

  if (token && currentUser) {
    showMainScreen();
  }

  // Online/offline events
  window.addEventListener('online', () => {
    offlineBanner.classList.remove('show');
    syncOfflineData();
  });
  window.addEventListener('offline', () => {
    offlineBanner.classList.add('show');
  });

  // Check initial online status
  if (!navigator.onLine) {
    offlineBanner.classList.add('show');
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
  const pendingCount = await getPendingCheckins();
  pendingCountEl.textContent = `(${pendingCount.length} pending)`;
  if (pendingCount.length > 0) {
    offlineBanner.classList.add('show');
  } else {
    offlineBanner.classList.remove('show');
  }

  const pending = await getPendingCheckins();
  if (pending.length === 0) return;

  syncIndicator.classList.add('show');

  for (const item of pending) {
    try {
      await apiRequest(item.type === 'in' ? '/api/attendance/check-in' : '/api/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify(item.data),
      });
    } catch (e) {
      console.error('Sync failed for item:', e);
      return;
    }
  }

  await clearPendingCheckins();
  syncIndicator.classList.remove('show');
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

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employee_id: empId }),
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('iattend_token', token);
    localStorage.setItem('iattend_user', JSON.stringify(currentUser));

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
  refreshStatus();
  checkDeviceBinding();
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

  // Check if action is check-in or check-out
  const actionText = actionBtn.textContent.trim();
  const isCheckIn = actionText === 'LOG IN' || actionText === 'CHECK IN';
  const isCheckOut = actionText === 'LOG OUT' || actionText === 'CHECK OUT';

  if (!isCheckIn && !isCheckOut) return;

  // If outside geofence and checking in, show modal
  if (!isInsideGeofence && isCheckIn) {
    pendingCheckinData = {
      lat: currentLat,
      lng: currentLng,
      accuracy: gpsAccuracy,
      android_id: await getDeviceId(),
      device_name: navigator.userAgent.slice(0, 50),
      biometric: false,
    };
    outsideModal.style.display = 'flex';
    outsideReason.value = '';
    outsideShortName.value = '';
    outsideReason.focus();
    return;
  }

  // Normal check-in/out (inside geofence) or check-out (anywhere)
  await performCheckin({
    lat: currentLat,
    lng: currentLng,
    accuracy: gpsAccuracy,
    android_id: await getDeviceId(),
    device_name: navigator.userAgent.slice(0, 50),
    biometric: false,
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
    if (navigator.onLine) {
      await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } else {
      // Save for offline sync
      await savePendingCheckin({
        type: isCheckIn ? 'in' : 'out',
        data: payload,
        timestamp: new Date().toISOString(),
      });
    }

    await refreshStatus();
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

// IndexedDB helpers for device_id
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
