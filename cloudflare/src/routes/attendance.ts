import { Hono } from 'hono';
import { Env } from '../types';
import { haversineM } from '../middleware/haversine';
import { generateUUID } from '../middleware/auth';

const attendance = new Hono<{ Bindings: Env }>();

// Middleware to extract user from JWT
attendance.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  // JWT verification is done in index.ts middleware
  await next();
});

// GET /api/attendance/rules - Get check rules
attendance.get('/rules', async (c) => {
  const settings = await c.env.DB.prepare(
    'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)'
  ).bind('school_location', 'check_radius_m', 'max_gps_accuracy_m', 'enforce_work_hours').all();

  const rules: Record<string, unknown> = {};
  for (const row of settings.results) {
    rules[row.key as string] = JSON.parse(row.value as string);
  }

  const location = rules.school_location as { lat: number; lng: number };
  return c.json({
    school_lat: location.lat,
    school_lng: location.lng,
    check_radius_m: rules.check_radius_m,
    max_gps_accuracy_m: rules.max_gps_accuracy_m,
  });
});

// POST /api/attendance/check-in
attendance.post('/check-in', async (c) => {
  const userId = c.get('userId') as string;
  const {
    lat, lng, accuracy, android_id, device_name,
    biometric = true, mode: p_mode, checked_at, note
  } = await c.req.json();

  // Validate inputs
  if (lat == null || lng == null) {
    return c.json({ error: 'GPS coordinates required' }, 400);
  }
  if (!android_id) {
    return c.json({ error: 'android_id required' }, 400);
  }

  // Load employee
  const employee = await c.env.DB.prepare(
    'SELECT id, is_active FROM employees WHERE id = ?'
  ).bind(userId).first();

  if (!employee || !employee.is_active) {
    return c.json({ error: 'Employee not found or inactive' }, 404);
  }

  // Load settings
  const settingsRows = await c.env.DB.prepare(
    'SELECT key, value FROM settings'
  ).all();

  const settings: Record<string, unknown> = {};
  for (const row of settingsRows.results) {
    settings[row.key as string] = JSON.parse(row.value as string);
  }

  const schoolLocation = settings.school_location as { lat: number; lng: number };
  const checkRadius = settings.check_radius_m as number;
  const maxAccuracy = settings.max_gps_accuracy_m as number;
  const enforceWorkHours = settings.enforce_work_hours as boolean;

  // Validate GPS accuracy
  if (accuracy != null && accuracy > maxAccuracy) {
    return c.json({ error: `GPS accuracy too low: ${accuracy}m (max: ${maxAccuracy}m)` }, 400);
  }

  // Calculate distance
  const distance = haversineM(lat, lng, schoolLocation.lat, schoolLocation.lng);

  // Server determines mode
  const serverMode = distance <= checkRadius ? 'inside' : 'outside';

  // Check time validity
  const checkTime = checked_at ? new Date(checked_at) : new Date();
  const now = new Date();
  const futureMs = checkTime.getTime() - now.getTime();
  if (futureMs > 5 * 60 * 1000) {
    return c.json({ error: 'Check time is in the future' }, 400);
  }
  const ageMs = now.getTime() - checkTime.getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return c.json({ error: 'Check time is more than 24 hours old' }, 400);
  }

  // Resolve device
  const device = await resolveDevice(c.env.DB, userId, android_id, device_name, settings.max_devices_per_account as number);
  if (typeof device === 'object' && 'error' in device) {
    return c.json({ error: device.error }, 400);
  }

  // Check if already checked in
  const lastRecord = await c.env.DB.prepare(
    `SELECT check_type FROM attendance 
     WHERE employee_id = ? 
     ORDER BY checked_at DESC LIMIT 1`
  ).bind(userId).first();

  if (lastRecord?.check_type === 'in') {
    return c.json({ error: 'Already checked in. Check out first.' }, 400);
  }

  // Enforce work hours
  if (enforceWorkHours) {
    const workStart = settings.work_start as string;
    const workEnd = settings.work_end as string;
    const timeStr = checkTime.toTimeString().slice(0, 5);
    if (timeStr < workStart || timeStr > workEnd) {
      return c.json({ error: `Outside work hours (${workStart}-${workEnd})` }, 400);
    }
  }

  // Insert attendance record
  const id = generateUUID();
  const checkedAtStr = checkTime.toISOString();

  await c.env.DB.prepare(
    `INSERT INTO attendance (id, employee_id, device_id, check_type, checked_at, latitude, longitude, gps_accuracy, distance_m, biometric_verified, mode, note)
     VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, device, checkedAtStr, lat, lng, accuracy, distance, biometric ? 1 : 0, serverMode, note || null).run();

  return c.json({
    id,
    check_type: 'in',
    checked_at: checkedAtStr,
    distance_m: distance,
    mode: serverMode,
  });
});

// POST /api/attendance/check-out
attendance.post('/check-out', async (c) => {
  const userId = c.get('userId') as string;
  const {
    lat, lng, accuracy, android_id, device_name,
    biometric = true, checked_at, note
  } = await c.req.json();

  if (lat == null || lng == null) {
    return c.json({ error: 'GPS coordinates required' }, 400);
  }
  if (!android_id) {
    return c.json({ error: 'android_id required' }, 400);
  }

  const employee = await c.env.DB.prepare(
    'SELECT id, is_active FROM employees WHERE id = ?'
  ).bind(userId).first();

  if (!employee || !employee.is_active) {
    return c.json({ error: 'Employee not found or inactive' }, 404);
  }

  const settingsRows = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const settings: Record<string, unknown> = {};
  for (const row of settingsRows.results) {
    settings[row.key as string] = JSON.parse(row.value as string);
  }

  const schoolLocation = settings.school_location as { lat: number; lng: number };
  const checkRadius = settings.check_radius_m as number;
  const maxAccuracy = settings.max_gps_accuracy_m as number;

  if (accuracy != null && accuracy > maxAccuracy) {
    return c.json({ error: `GPS accuracy too low: ${accuracy}m (max: ${maxAccuracy}m)` }, 400);
  }

  const distance = haversineM(lat, lng, schoolLocation.lat, schoolLocation.lng);
  const serverMode = distance <= checkRadius ? 'inside' : 'outside';

  const checkTime = checked_at ? new Date(checked_at) : new Date();
  const now = new Date();

  const lastRecord = await c.env.DB.prepare(
    `SELECT check_type FROM attendance 
     WHERE employee_id = ? 
     ORDER BY checked_at DESC LIMIT 1`
  ).bind(userId).first();

  if (!lastRecord || lastRecord.check_type === 'out') {
    return c.json({ error: 'Not checked in. Check in first.' }, 400);
  }

  const device = await resolveDevice(c.env.DB, userId, android_id, device_name, settings.max_devices_per_account as number);
  if (typeof device === 'object' && 'error' in device) {
    return c.json({ error: device.error }, 400);
  }

  const id = generateUUID();
  const checkedAtStr = checkTime.toISOString();

  await c.env.DB.prepare(
    `INSERT INTO attendance (id, employee_id, device_id, check_type, checked_at, latitude, longitude, gps_accuracy, distance_m, biometric_verified, mode, note)
     VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, device, checkedAtStr, lat, lng, accuracy, distance, biometric ? 1 : 0, serverMode, note || null).run();

  return c.json({
    id,
    check_type: 'out',
    checked_at: checkedAtStr,
    distance_m: distance,
    mode: serverMode,
  });
});

// GET /api/attendance/today - Get today's attendance for user
attendance.get('/today', async (c) => {
  const userId = c.get('userId') as string;
  const today = new Date().toISOString().split('T')[0];

  const records = await c.env.DB.prepare(
    `SELECT * FROM attendance 
     WHERE employee_id = ? AND date(checked_at) = ?
     ORDER BY checked_at ASC`
  ).bind(userId, today).all();

  return c.json(records.results);
});

async function resolveDevice(
  db: D1Database,
  employeeId: string,
  androidId: string,
  deviceName: string | null,
  maxDevices: number
): Promise<string | { error: string }> {
  if (!androidId) {
    return { error: 'android_id is required' };
  }

  // STRICT: Check if this device is bound to ANY employee
  const anyBinding = await db.prepare(
    `SELECT employee_id, is_active FROM devices 
     WHERE android_id = ? AND is_active = 1`
  ).bind(androidId).first();

  if (anyBinding) {
    // Device is bound to someone
    if (anyBinding.employee_id !== employeeId) {
      // Bound to a DIFFERENT employee - reject
      return { error: 'This device is bound to another account. Contact admin to unbind.' };
    }
    // Bound to THIS employee - return existing device
    const myDevice = await db.prepare(
      `SELECT id FROM devices 
       WHERE employee_id = ? AND android_id = ? AND is_active = 1`
    ).bind(employeeId, androidId).first();
    return myDevice?.id as string;
  }

  // Device not bound to anyone - check if employee already has a device
  const existingDevice = await db.prepare(
    `SELECT id, android_id FROM devices 
     WHERE employee_id = ? AND is_active = 1`
  ).bind(employeeId).first();

  if (existingDevice) {
    // Employee already has a DIFFERENT device bound
    return { error: `You already have a device bound (${existingDevice.android_id}). Contact admin to unbind first.` };
  }

  // No binding exists - create new binding
  const deviceId = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO devices (id, employee_id, android_id, device_name) 
       VALUES (?, ?, ?, ?)`
    ).bind(deviceId, employeeId, androidId, deviceName).run();
  } catch (e) {
    return { error: 'Device already bound to another account' };
  }

  return deviceId;
}

export default attendance;
