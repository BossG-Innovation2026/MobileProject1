# Cloudflare Deployment Guide

## Prerequisites

1. Install Node.js (v18+)
2. Install Wrangler CLI: `npm install -g wrangler`
3. Login to Cloudflare: `wrangler login`

## Step 1: Create D1 Database

```bash
cd cloudflare
wrangler d1 create cabiao-attendance
```

Copy the `database_id` from the output and update `wrangler.toml`.

## Step 2: Initialize Database

```bash
# Local development
npm run db:init

# Production (remote)
npm run db:init:remote
```

## Step 3: Deploy Workers API

```bash
npm install
npm run deploy
```

Copy the Workers URL (e.g., `https://cabiao-attendance-api.YOUR_SUBDOMAIN.workers.dev`).

## Step 4: Update Dashboard Config

Edit `admin-dashboard/js/config.js`:

```javascript
window.ATTENDANCE_CONFIG = {
  API_URL: "https://cabiao-attendance-api.YOUR_SUBDOMAIN.workers.dev",
};
```

## Step 5: Deploy Admin Dashboard to Cloudflare Pages

### Option A: Direct Upload
```bash
cd admin-dashboard
npx wrangler pages deploy . --project-name=iattend-cshs
```

### Option B: Git Integration
1. Push to GitHub
2. Go to Cloudflare Pages
3. Connect to your repository
4. Set build command: (leave empty - static site)
5. Set output directory: `.`

## Step 6: Update Android App

Update the Android app to use the new API URL. See `android/README.md` for details.

## Environment Variables

Set these in Cloudflare Workers dashboard (Settings → Variables):

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret key for JWT signing (generate a strong random string) |

## API Endpoints

### Auth
- `POST /api/auth/login` - Login with employee_id
- `POST /api/auth/device-owner` - Check device binding

### Attendance
- `GET /api/attendance/rules` - Get check rules
- `POST /api/attendance/check-in` - Check in
- `POST /api/attendance/check-out` - Check out
- `GET /api/attendance/today` - Get today's records

### Admin
- `GET /api/admin/status` - Current clocked-in status
- `GET /api/admin/employees` - List employees
- `POST /api/admin/employees` - Register employee
- `PUT /api/admin/employees/:id` - Update employee
- `PUT /api/admin/employees/:id/toggle` - Toggle active
- `GET /api/admin/devices` - List devices
- `DELETE /api/admin/devices/:id` - Unbind device
- `GET /api/admin/attendance` - Get attendance records
- `POST /api/admin/override` - Manual override
- `PUT /api/admin/settings` - Update settings
- `GET /api/admin/departments` - List departments
- `POST /api/admin/departments` - Create department
- `PUT /api/admin/departments/:id` - Update department
- `GET /api/admin/positions` - List positions
- `POST /api/admin/positions` - Create position
- `PUT /api/admin/positions/:id` - Update position
- `GET /api/admin/daily-pairs` - Paired IN/OUT records
