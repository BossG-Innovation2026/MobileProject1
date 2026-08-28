// Cabiao SHS Attendance - API Client for Cloudflare Workers
class AttendanceAPI {
  constructor() {
    this.baseUrl = window.ATTENDANCE_CONFIG.API_URL;
    this.token = localStorage.getItem('attendance_token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('attendance_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('attendance_token');
  }

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.clearToken();
      window.location.reload();
      throw new Error('Unauthorized');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // Auth
  async login(employeeId) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employee_id: employeeId }),
    });
    this.setToken(data.token);
    return data.user;
  }

  // Attendance rules
  async getRules() {
    return this.request('/api/attendance/rules');
  }

  // Admin endpoints
  async getStatus() {
    return this.request('/api/admin/status');
  }

  async getEmployees() {
    return this.request('/api/admin/employees');
  }

  async createEmployee(employee) {
    return this.request('/api/admin/employees', {
      method: 'POST',
      body: JSON.stringify(employee),
    });
  }

  async updateEmployee(id, employee) {
    return this.request(`/api/admin/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(employee),
    });
  }

  async toggleEmployee(id) {
    return this.request(`/api/admin/employees/${id}/toggle`, {
      method: 'PUT',
    });
  }

  async deleteEmployee(id) {
    return this.request(`/api/admin/employees/${id}`, {
      method: 'DELETE',
    });
  }

  async getDevices() {
    return this.request('/api/admin/devices');
  }

  async unbindDevice(id) {
    return this.request(`/api/admin/devices/${id}`, {
      method: 'DELETE',
    });
  }

  async getAttendance(from, to, departmentId) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (departmentId) params.append('department_id', departmentId);
    return this.request(`/api/admin/attendance?${params.toString()}`);
  }

  async overrideAttendance(override) {
    return this.request('/api/admin/override', {
      method: 'POST',
      body: JSON.stringify(override),
    });
  }

  async updateSetting(key, value) {
    return this.request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    });
  }

  async getDepartments() {
    return this.request('/api/admin/departments');
  }

  async createDepartment(department) {
    return this.request('/api/admin/departments', {
      method: 'POST',
      body: JSON.stringify(department),
    });
  }

  async updateDepartment(id, department) {
    return this.request(`/api/admin/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(department),
    });
  }

  async getPositions() {
    return this.request('/api/admin/positions');
  }

  async createPosition(position) {
    return this.request('/api/admin/positions', {
      method: 'POST',
      body: JSON.stringify(position),
    });
  }

  async updatePosition(id, position) {
    return this.request(`/api/admin/positions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(position),
    });
  }

  async getDailyPairs(from, to) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    return this.request(`/api/admin/daily-pairs?${params.toString()}`);
  }
}

window.api = new AttendanceAPI();
