export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  employee_id: string;
  role: 'employee' | 'admin';
  is_active: number;
  department_id: string;
  position_id: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  device_id: string | null;
  check_type: 'in' | 'out';
  checked_at: string;
  latitude: number;
  longitude: number;
  gps_accuracy: number | null;
  distance_m: number | null;
  biometric_verified: number;
  mode: 'inside' | 'outside';
  status: 'valid' | 'overridden';
  note: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  employee_id: string;
  android_id: string;
  device_name: string | null;
  is_active: number;
  bound_at: string;
}

export interface Department {
  id: string;
  name: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface Position {
  id: string;
  name: string;
  department_id: string | null;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface Settings {
  key: string;
  value: string;
  updated_at: string;
}
