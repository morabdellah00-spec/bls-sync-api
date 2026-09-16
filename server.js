const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// FIX: Added forceSyncTimestamp so extensions can detect when to re-pull
let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString(),
  forceSyncTimestamp: 0,
  _deletedSince: [] // Track deleted passports with timestamps for delta sync
};

// Hidden groups — extensions won't receive applicants from these groups
let hiddenGroups = new Set();

let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

const crypto = require('crypto');

// ── ACCESS ──────────────────────────────────────────────────────────
// One setting, ADMIN_KEY (Railway → Variables). While it is unset the
// dashboard stays open exactly as before and shows a warning banner.
// Once set:
//   • /  needs the key: visit /?key=XXX once, a cookie remembers it
//   • destructive + admin-only API routes need the same cookie
//   • every group gets a client link /g/<token>. The token is an HMAC of
//     the group name under ADMIN_KEY — nothing is stored, so links
//     survive every restart, and they cannot be guessed without the key.
// The extension's own sync routes are deliberately left open; the
// browsers do not send any credential yet.
const ADMIN_KEY = (process.env.ADMIN_KEY || '').trim();
const authEnabled = () => ADMIN_KEY.length > 0;

function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookieVal(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function isAdmin(req) {
  if (!authEnabled()) return true;               // no key configured → open
  return safeEq(cookieVal(req, 'admin'), ADMIN_KEY) || safeEq(req.query.key, ADMIN_KEY);
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'admin key required' });
}

// Client token for a group. 20 hex chars = 80 bits; unguessable.
function groupToken(groupName) {
  if (!authEnabled()) return null;
  return crypto.createHmac('sha256', ADMIN_KEY).update(String(groupName)).digest('hex').slice(0, 20);
}
// Every group name we know of — the groups list plus anything on an applicant.
function allGroupNames() {
  const set = new Set(sharedData.groups || []);
  (sharedData.applicants || []).forEach(a => { if (a.group) set.add(a.group); });
  return [...set];
}
function groupForToken(token) {
  if (!authEnabled() || !token) return null;
  for (const g of allGroupNames()) {
    if (safeEq(groupToken(g), token)) return g;
  }
  return null;
}

function loginPage(res, bad) {
  res.status(401).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title>'
  + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1424;font-family:system-ui;color:#e2e8f0}'
  + 'form{background:#111c2e;padding:34px 38px;border-radius:16px;border:1px solid rgba(16,185,129,.25);box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:320px}'
  + 'h2{margin:0 0 6px;color:#10b981}p{margin:0 0 18px;opacity:.7;font-size:13px}'
  + 'input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#0b1424;color:#fff;font-size:15px;margin-bottom:12px}'
  + 'button{width:100%;padding:12px;border:none;border-radius:10px;background:#10b981;color:#06251d;font-weight:800;font-size:15px;cursor:pointer}'
  + '.bad{color:#f87171;font-size:13px;margin-bottom:10px}</style></head><body>'
  + '<form method="GET" action="/"><h2>Admin dashboard</h2><p>Enter the admin key to continue.</p>'
  + (bad ? '<div class="bad">Wrong key.</div>' : '')
  + '<input type="password" name="key" placeholder="Admin key" autofocus autocomplete="current-password">'
  + '<button>Sign in</button></form></body></html>');
}

// Admin dashboard
app.get('/', (req, res) => {
  if (authEnabled()) {
    if (req.query.key !== undefined) {
      if (!safeEq(req.query.key, ADMIN_KEY)) return loginPage(res, true);
      // Remember it and drop the key from the URL
      res.setHeader('Set-Cookie', 'admin=' + encodeURIComponent(ADMIN_KEY) + '; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=31536000');
      return res.redirect('/');
    }
    if (!isAdmin(req)) return loginPage(res, false);
  }
  res.send(renderDashboard({ mode: 'admin' }));
});

// Client portal — one group only, no way to reach the others
app.get('/g/:token', (req, res) => {
  const group = groupForToken(req.params.token);
  if (!group) return res.status(404).send('<!DOCTYPE html><meta charset="utf-8"><body style="font-family:system-ui;background:#0b1424;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><div style="font-size:48px">🔗</div><h2>This link is not valid</h2><p style="opacity:.7">Ask for a new link.</p></div>');
  res.send(renderDashboard({ mode: 'client', group, token: req.params.token }));
});

function renderDashboard(opts) {
  const mode  = opts.mode || 'admin';
  const group = opts.group || '';
  const apiBase = mode === 'client' ? '/g/' + opts.token : '';
  const boot = '<script>'
    + 'window.__MODE='  + JSON.stringify(mode)  + ';'
    + 'window.__GROUP=' + JSON.stringify(group) + ';'
    + 'window.__API='   + JSON.stringify(apiBase) + ';'
    + 'window.__AUTH='  + (authEnabled() ? 'true' : 'false') + ';'
    + '</script>';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Droid Applicant</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(160deg, #0b1220 0%, #0f1b2b 45%, #0c1a17 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container { max-width: 1600px; margin: 0 auto; }
        
        .header {
            background: #10192b;
            border: 1px solid rgba(16,185,129,.18);
            border-radius: 16px;
            padding: 25px 35px;
            margin-bottom: 25px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.35);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header-left h1 { font-size: 26px; font-weight: 900; letter-spacing:.5px; background: linear-gradient(135deg,#34d399,#5eead4,#a7f3d0); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom: 5px; }
        .header-left small { color: #7f8c8d; font-size: 13px; }
        .header-right { display: flex; gap: 15px; align-items: center; }
        
        .sync-status {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 20px;
            background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%);
            border-radius: 25px; font-size: 14px; color: white; font-weight: 600;
        }
        
        .sync-dot {
            width: 12px; height: 12px; border-radius: 50%;
            background: #27ae60; animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.7; }
        }
        
        /* FIX: Live indicator for auto-refresh */
        .live-badge {
            font-size: 11px; padding: 4px 10px;
            background: rgba(39,174,96,0.15); color: #27ae60;
            border-radius: 20px; border: 1px solid rgba(39,174,96,0.3);
            font-weight: 600;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px; margin-bottom: 25px;
        }
        
        .stat-card {
            background: #10192b; padding: 25px; border-radius: 16px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            display: flex; align-items: center; gap: 20px;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.15); }
        
        .stat-icon {
            width: 60px; height: 60px; border-radius: 14px;
            display: flex; align-items: center; justify-content: center;
            font-size: 28px;
            background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%);
        }
        
        .stat-content h3 { font-size: 36px; font-weight: 700; color: #2c3e50; margin-bottom: 5px; }
        .stat-content p { font-size: 14px; color: #7f8c8d; font-weight: 500; }
        
        .card {
            background: #10192b; border-radius: 16px; padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        }
        
        .section-title {
            font-size: 22px; font-weight: 700; margin-bottom: 25px;
            color: #2c3e50; display: flex; align-items: center; gap: 10px;
        }
        
        .toolbar { display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap; }
        
        .search-box {
            flex: 1; min-width: 250px; padding: 12px 20px;
            border: 2px solid rgba(255,255,255,.08); border-radius: 12px;
            font-size: 15px; transition: all 0.3s; background: #0b1424; color: #fff;
        }
        
        .search-box:focus {
            outline: none; border-color: #10b981; background: #10192b;
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.15);
        }
        
        .btn {
            padding: 12px 24px; border: none; border-radius: 12px;
            font-size: 14px; font-weight: 600; cursor: pointer;
            transition: all 0.3s; display: inline-flex; align-items: center; gap: 8px;
        }
        
        .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        
        .btn-primary { background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%); color: white; }
        .btn-success { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: white; }
        .btn-danger  { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; }
        .btn-warning { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; }
        
        .groups-filter { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 25px; }
        
        .group-badge {
            padding: 10px 20px;
            background: #0b1424; border: 2px solid rgba(255,255,255,.08); border-radius: 25px;
            font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s;
            display: inline-flex; align-items: center; gap: 8px;
        }
        
        .group-badge:hover { background: #10b981; color: white; border-color: #10b981; transform: translateY(-2px); }
        .group-badge.active { background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%); color: white; border-color: transparent; }
        .group-delete { color: #e74c3c; font-weight: bold; cursor: pointer; margin-left: 5px; transition: color 0.3s; }
        .group-badge:hover .group-delete { color: white; }
        
        table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
        
        thead th {
            background: #0b1424; padding: 15px; text-align: left;
            font-weight: 700; color: #2c3e50; font-size: 13px;
            text-transform: uppercase; letter-spacing: 0.5px; border: none;
        }
        
        tbody tr { background: #10192b; transition: all 0.3s; }
        tbody tr:hover { background: #0d1729; transform: translateX(5px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        
        tbody td { padding: 15px; border-top: 1px solid rgba(255,255,255,.05); border-bottom: 1px solid rgba(255,255,255,.05); color: #a7f3d0; }
        tbody td:nth-child(2) { color: #34d399; font-weight: 700; }
        thead th { color: #6b8f85 !important; }
        tbody td:first-child { border-left: 1px solid #f1f3f5; border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        tbody td:last-child  { border-right: 1px solid #f1f3f5; border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        
        .photo-thumb {
            width: 50px; height: 50px; border-radius: 12px; object-fit: cover;
            border: 3px solid #10b981; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        
        .no-photo {
            width: 50px; height: 50px; border-radius: 12px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            display: flex; align-items: center; justify-content: center;
            color: #95a5a6; font-size: 24px;
        }
        
        .actions { display: flex; gap: 8px; }
        
        .icon-btn {
            padding: 8px 14px; background: #0b1424; border: 1px solid rgba(255,255,255,.08);
            border-radius: 8px; cursor: pointer; transition: all 0.3s; font-size: 14px;
        }
        
        .icon-btn:hover { background: #10b981; color: white; border-color: #10b981; transform: translateY(-2px); }
        
        .modal {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 1000; align-items: center; justify-content: center; animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal.active { display: flex; }
        
        .modal-content {
            background: #0f1b2b; border: 1px solid rgba(16,185,129,.15); border-radius: 20px; width: 100%; max-width: 700px;
            max-height: 90vh; overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: slideUp 0.3s;
        }
        
        @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        
        .modal-header {
            padding: 25px 30px; border-bottom: 2px solid #f1f3f5;
            display: flex; justify-content: space-between; align-items: center;
            background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%);
            border-radius: 20px 20px 0 0;
        }
        
        .modal-header h2 { color: white; font-size: 24px; font-weight: 700; }
        
        .close-btn {
            background: rgba(255,255,255,0.2); border: none; font-size: 28px; color: white;
            cursor: pointer; width: 40px; height: 40px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center; transition: all 0.3s;
        }
        
        .close-btn:hover { background: rgba(255,255,255,0.3); transform: rotate(90deg); }
        
        .modal-body { padding: 30px; }
        
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; color: #2c3e50; }
        
        .form-group input,
        .form-group select {
            width: 100%; padding: 14px 18px; border: 2px solid rgba(255,255,255,.08);
            border-radius: 12px; font-size: 15px; transition: all 0.3s; background: #0b1424; color: #ffffff !important;
            color-scheme: dark;
        }
        .form-group input::placeholder { color: #4c6b64; }
        .form-group input:not(:placeholder-shown),
        .form-group select:not([value=""]):valid {
            border-color: rgba(255,255,255,.35) !important;
        }
        .form-group input:-webkit-autofill,
        .form-group input:-webkit-autofill:hover,
        .form-group input:-webkit-autofill:focus {
            -webkit-text-fill-color: #ffffff !important;
            -webkit-box-shadow: 0 0 0 1000px #0b1424 inset !important;
            box-shadow: 0 0 0 1000px #0b1424 inset !important;
            caret-color: #ffffff;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: none; border-color: #10b981; background: #10192b;
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.15);
        }
        
        .modal-footer {
            padding: 20px 30px; border-top: 2px solid #f1f3f5;
            display: flex; gap: 12px; justify-content: flex-end;
            background: #0b1424; border-radius: 0 0 20px 20px;
        }
        
        .toast {
            position: fixed; bottom: 30px; right: 30px;
            padding: 18px 24px; background: #2c3e50; color: white;
            border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            z-index: 2000; animation: slideInRight 0.3s; font-weight: 600;
        }
        
        @keyframes slideInRight { from { transform: translateX(400px); } to { transform: translateX(0); } }
        
        .toast.success { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); }
        .toast.error   { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); }
        
        .empty-state { text-align: center; padding: 80px 20px; color: #95a5a6; }
        .empty-state-icon { font-size: 64px; margin-bottom: 20px; }
        
        .upload-status {
            margin-top: 12px; padding: 12px; background: #f0f4ff;
            border-radius: 10px; font-size: 13px; color: #10b981; text-align: center; font-weight: 600;
        }
        
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #0b1424; }
        ::-webkit-scrollbar-thumb { background: linear-gradient(135deg, #10b981 0%, #0ea5a3 100%); border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: #10b981; }
        /* ── MOBILE (phones open the group link here) ─────────────── */
        @media (max-width: 768px) {
            body { padding: 10px; }
            .header { flex-direction: column; align-items: flex-start; gap: 14px; padding: 18px; }
            .header-right { width: 100%; }
            .header-left h1 { font-size: 21px; }
            .card { padding: 16px 12px; overflow-x: auto; }
            .section-title { font-size: 16px; }
            /* Toolbar: search full width, buttons share the row */
            .toolbar { gap: 8px; }
            .search-box { flex: 1 1 100%; min-width: 0; }
            .toolbar .btn { flex: 1 1 auto; justify-content: center; padding: 12px 10px; font-size: 13px; }
            /* Table scrolls sideways instead of crushing */
            table { min-width: 620px; }
            tbody td, thead th { padding: 10px; font-size: 13px; }
            /* Modal fills the screen and stacks photo above fields */
            .modal { align-items: flex-start; padding: 0; }
            .modal-content { width: 100%; max-width: 100% !important; min-height: 100vh; border-radius: 0; }
            .modal-header { border-radius: 0; padding: 18px 20px; }
            .modal-header h2 { font-size: 19px; }
            .modal-body { grid-template-columns: 1fr !important; gap: 16px !important; padding: 18px 18px 8px !important; }
            .modal-body > div { grid-template-columns: 1fr !important; }
            .modal-footer { flex-direction: column-reverse; gap: 10px; padding: 16px 18px; }
            .modal-footer .btn { width: 100%; justify-content: center; }
            .stats { grid-template-columns: 1fr; gap: 12px; }
            .stat-content h3 { font-size: 26px; }
            #export-dd { position: fixed !important; left: 10px !important; right: 10px !important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-left" style="display:flex;align-items:center;gap:18px">
                <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#10b981,#0ea5a3,#0f766e);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;letter-spacing:-1px;color:#06251d;box-shadow:0 0 0 3px rgba(16,185,129,.18),0 8px 24px rgba(16,185,129,.35);flex-shrink:0">AM</div>
                <div>
                    <h1>DROID APPLICANT</h1>
                    <small style="color:#64a89c;font-weight:600;letter-spacing:.4px">BLS Applicant Control · Spain · Morocco · Portugal</small>
                </div>
            </div>
            <div class="header-right">
                <!-- FIX: live badge shows auto-refresh is active -->
                <span class="live-badge">🟢 Live</span>
                <div class="sync-status">
                    <div class="sync-dot"></div>
                    <span>Connected</span>
                </div>
                <button class="btn btn-warning" onclick="syncNow()">🔄 Sync Now</button>
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-content"><h3 id="total-applicants">0</h3><p>Total Applicants</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📁</div>
                <div class="stat-content"><h3 id="total-groups">0</h3><p>Groups</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📸</div>
                <div class="stat-content"><h3 id="with-photos">0</h3><p>With Photos</p></div>
            </div>
        </div>
        
        <div class="card">
            <div class="section-title"><span>👥</span><span>Applicants Management</span></div>
            
            <div class="toolbar">
                <input type="text" class="search-box" id="search" placeholder="🔍 Search by name, passport..." oninput="filterApplicants()">
                <button class="btn btn-success" onclick="showAddModal()">➕ Add Applicant</button>
                <button class="btn btn-primary" onclick="showAddGroupModal()">📁 New Group</button>
                <button class="btn btn-primary" onclick="importData()">📤 Import JSON</button>
                <div style="position:relative;display:inline-block">
                    <button class="btn btn-warning" onclick="toggleExportDD()">💾 Export ▾</button>
                    <div id="export-dd" style="display:none;position:absolute;top:100%;left:0;margin-top:6px;background:#0f1b2b;border:1px solid rgba(16,185,129,.2);border-radius:10px;overflow:hidden;z-index:100;min-width:170px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
                        <div style="padding:8px 14px;font-size:10px;color:#6b8f85;font-weight:700;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06)">Export by city</div>
                        <div onclick="exportByCity('ALL')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">📦 ALL</div>
                        <div onclick="exportByCity('CASABLANCA')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ CASABLANCA</div>
                        <div onclick="exportByCity('RABAT')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ RABAT</div>
                        <div onclick="exportByCity('NADOR')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ NADOR</div>
                        <div onclick="exportByCity('TETOUAN')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ TETOUAN</div>
                        <div onclick="exportByCity('AGADIR')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ AGADIR</div>
                        <div onclick="exportByCity('TANGER')" style="padding:8px 14px;color:#e5f7f1;cursor:pointer;font-size:13px;font-weight:600" onmouseenter="this.style.background='rgba(16,185,129,.15)'" onmouseleave="this.style.background=''">🏙️ TANGIER</div>
                    </div>
                </div>
                <button class="btn btn-danger" onclick="deleteAll()">🗑️ Delete All</button>
            </div>
            
            <div class="groups-filter" id="groups-filter"></div>

            <!-- BOOKED (PAYMENT) — everyone who reached payment, armed or not -->
            <div id="booked-panel" style="display:none;margin:0 0 16px;padding:14px 18px;border-radius:14px;background:linear-gradient(135deg,#052e1a,#0f1b2b);border:1px solid rgba(22,163,74,.4)">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span style="font-weight:800;font-size:15px;color:#4ade80">✅ Booked</span>
                    <span id="booked-count" style="font-size:12px;font-weight:700;padding:2px 10px;border-radius:20px;background:rgba(22,163,74,.2);color:#4ade80"></span>
                </div>
                <div id="booked-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
            </div>

            <div id="af-panel" style="display:none;margin:0 0 20px;padding:16px 18px;border-radius:14px;background:linear-gradient(135deg,#1a1330,#0f1b2b);border:1px solid rgba(245,158,11,.35)">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
                    <div style="font-weight:800;font-size:15px;color:#fbbf24">🎯 Auto-fill order <span id="af-count" style="opacity:.7;font-weight:600"></span></div>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <span id="af-status" style="font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;background:rgba(255,255,255,.06);color:#94a3b8">idle</span>
                        <button class="btn btn-warning" style="padding:8px 16px;font-size:13px" onclick="armQueue()">▶ Arm</button>
                        <button class="btn btn-danger" style="padding:8px 16px;font-size:13px" onclick="disarmQueue()">■ Disarm</button>
                    </div>
                </div>
                <div id="af-list" style="display:flex;flex-wrap:wrap;gap:8px"></div>
                <div style="font-size:11px;opacity:.55;margin-top:8px">Pick applicants with 🎯 in order. Arm, then the browsers that win slots fill them 1, 2, 3… Booked (PAYMENT) applicants are skipped automatically.</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Photo</th><th>Name</th><th>Passport</th>
                        <th>Date of Birth</th><th>Place of Birth</th>
                        <th>Group</th><th>Actions</th>
                    </tr>
                </thead>
                <tbody id="tbody">
                    <tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📋</div><p>Loading applicants...</p></div></td></tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <div id="modal" class="modal">
        <div class="modal-content" style="max-width:780px">
            <div class="modal-header" style="background:linear-gradient(135deg,#0c2a22,#0f1b2b);border-bottom:3px solid #10b981">
                <div><h2 id="modal-title" style="color:#e5f7f1">Add Applicant</h2><small style="color:#5eead4;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;font-size:10px">Passport Data Page</small></div>
                <button class="close-btn" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body" style="display:grid;grid-template-columns:170px 1fr;gap:24px;padding:28px 30px">
                <div style="display:flex;flex-direction:column;gap:12px">
                    <label for="fph" style="width:100%;aspect-ratio:1;border-radius:14px;background:#0b1424;border:2px dashed rgba(16,185,129,.3);display:flex;align-items:center;justify-content:center;font-size:36px;color:rgba(16,185,129,.5);overflow:hidden;cursor:pointer;position:relative" id="photo-drop-box">
                        <span id="photo-drop-plus">+</span>
                        <div id="prev" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"></div>
                    </label>
                    <input type="file" id="fph" accept="image/*" style="display:none">
                    <span style="font-size:10px;color:#6b8f85;text-align:center">~100KB auto-compress</span>
                    <div class="form-group" style="margin-bottom:0">
                        <label>📁 Group</label>
                        <select id="fg" onchange="refreshFamilyList()" onkeypress="handleEnter(event, 'ff')">
                            <option value="">No Group</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Type</label>
                        <div style="display:flex;gap:8px">
                            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;border-radius:8px;background:#0b1424;border:1px solid rgba(255,255,255,.12);cursor:pointer;font-size:12px;font-weight:700">
                                <input type="radio" name="ftype" value="indv" id="ftype-indv" checked onchange="onTypeChange()"> 👤 Individual
                            </label>
                            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;border-radius:8px;background:#0b1424;border:1px solid rgba(255,255,255,.12);cursor:pointer;font-size:12px;font-weight:700">
                                <input type="radio" name="ftype" value="fam" id="ftype-fam" onchange="onTypeChange()"> 👨‍👩‍👧 Family
                            </label>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:0;display:none" id="fam-wrap">
                        <label>👨‍👩‍👧 Family name</label>
                        <input type="text" id="ffam" list="fam-options" placeholder="e.g. BENALI" autocomplete="off">
                        <datalist id="fam-options"></datalist>
                        <small style="opacity:.6;font-size:10px">Pick an existing family, or type a new name for the first member.</small>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;align-content:start">
                    <div class="form-group" style="margin-bottom:0">
                        <label>First Name *</label>
                        <input type="text" id="ff" placeholder="First name" onkeypress="handleEnter(event, 'fl')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Last Name *</label>
                        <input type="text" id="fl" placeholder="Last name" onkeypress="handleEnter(event, 'fp')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Passport Number *</label>
                        <input type="text" id="fp" placeholder="Passport" onkeypress="handleEnter(event, 'fd')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Date of Birth</label>
                        <input type="date" id="fd" onkeypress="handleEnter(event, 'fb')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Place of Birth</label>
                        <select id="fb" onchange="autoFillIssuePlace()" onkeypress="handleEnter(event, 'fi')">
                            <option value="">Select...</option>
                            <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                            <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                            <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Issue Place</label>
                        <select id="fi" onkeypress="handleEnter(event, 'fa1')">
                            <option value="">Select...</option>
                            <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                            <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                            <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0;grid-column:1/-1">
                        <label>Home Address</label>
                        <input type="text" id="fa1" placeholder="Home address" onkeypress="handleEnter(event, 'fc')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>City</label>
                        <input type="text" id="fc" placeholder="City" onkeypress="handleEnter(event, 'fpc')">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Postal Code</label>
                        <input type="text" id="fpc" placeholder="Postal code">
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <div id="upload-status" class="upload-status" style="display:none;flex:1"></div>
                <button class="btn btn-danger" onclick="closeModal()">✕ Cancel</button>
                <button class="btn btn-success" id="save-btn" onclick="save()">✓ Save Applicant</button>
            </div>
        </div>
    </div>
    
    <script>
        const API = window.location.origin + (window.__API || '');
        let apps = [], groups = [], editIdx = -1, filter = 'all';

        // ─── City → Postal Code auto-fill ──────────────────────────────
        // Editable list of Moroccan cities → postal codes. When you type
        // a matching city in the "🏙️ City" field of the applicant form,
        // the "📮 Postal Code" field auto-fills.
        //
        // To add/edit/remove cities: just modify this object. Case-insensitive
        // match on the city name (trimmed). Keys are lowercase.
        const CITY_POSTAL_MAP = {
            'casablanca':   '20000',
            'rabat':        '10000',
            'sale':         '11000',
            'salé':         '11000',
            'kenitra':      '14000',
            'khemisset':    '15000',
            'sidi kacem':   '16000',
            'sidi slimane': '14200',
            'mohammedia':   '28800',
            'mohammédia':   '28800',
            'berrechid':    '26100',
            'settat':       '26000',
            'khouribga':    '25000',
            'el jadida':    '24000',
            'safi':         '46000',
            'essaouira':    '44000',
            'marrakech':    '40000',
            'ouarzazate':   '45000',
            'beni mellal':  '23000',
            'béni mellal':  '23000',
            'fes':          '30000',
            'fès':          '30000',
            'meknes':       '50000',
            'meknès':       '50000',
            'ifrane':       '53000',
            'azrou':        '53100',
            'errachidia':   '52000',
            'taza':         '35000',
            'oujda':        '60000',
            'nador':        '62000',
            'al hoceima':   '32000',
            'tanger':       '90000',
            'tangier':      '90000',
            'tetouan':      '93000',
            'tétouan':      '93000',
            'chefchaouen':  '91000',
            'larache':      '92000',
            'agadir':       '80000',
            'inezgane':     '86350',
            'taroudant':    '83000',
            'tiznit':       '85000',
            'guelmim':      '81000',
            'laayoune':     '70000',
            'laâyoune':     '70000',
            'dakhla':       '73000',
        };

        function lookupPostalByCity(cityRaw) {
            if (!cityRaw) return null;
            return CITY_POSTAL_MAP[String(cityRaw).trim().toLowerCase()] || null;
        }

        // Attach the auto-fill listener as soon as the field exists in DOM.
        // Since this script runs after the modal HTML is rendered, the
        // elements are already there.
        (function attachCityAutofill() {
            const cityEl   = document.getElementById('fc');
            const postalEl = document.getElementById('fpc');
            if (!cityEl || !postalEl) return;
            const fill = () => {
                const p = lookupPostalByCity(cityEl.value);
                if (!p) return;
                if (postalEl.value === p) return;
                postalEl.value = p;
                postalEl.dispatchEvent(new Event('input',  { bubbles: true }));
                postalEl.dispatchEvent(new Event('change', { bubbles: true }));
            };
            cityEl.addEventListener('input', fill);   // fires on every keystroke
            cityEl.addEventListener('blur',  fill);   // and on tab-out
        })();
        let currentPhotoBase64 = null;
        // FIX: track modal state so auto-refresh doesn't interrupt editing
        let isModalOpen = false;

        function autoFillIssuePlace() {
            const placeOfBirth = document.getElementById('fb').value;
            const issuePlace = document.getElementById('fi');
            if (placeOfBirth && !issuePlace.value) {
                issuePlace.value = placeOfBirth;
            }
        }

        function handleEnter(event, nextFieldId) {
            if (event.key === 'Enter') {
                event.preventDefault();
                const nextField = document.getElementById(nextFieldId);
                if (nextField) { nextField.focus(); } else { save(); }
            }
        }

        async function loadData() {
            try {
                const r = await fetch(API + '/api/applicants?all=1');
                const d = await r.json();
                apps = d.applicants || [];
                groups = d.groups || [];
                // A group created since the page loaded has no link yet —
                // fetch again so its 🔗 appears without a manual refresh.
                if (!IS_CLIENT && window.__AUTH && groups.some(g => !groupLinks[g])) await loadGroupLinks();
                updateUI();
            } catch (e) {
                console.error('Load failed', e);
                // Don't show error toast on background auto-refresh
            }
        }

        function updateUI() {
            document.getElementById('total-applicants').textContent = apps.length;
            document.getElementById('total-groups').textContent = groups.length;
            document.getElementById('with-photos').textContent = apps.filter(a => a.photo).length;
            
            // FIX: Only update modal group dropdown if modal is not open (avoid disrupting editing)
            if (!isModalOpen && !IS_CLIENT) {
                const fg = document.getElementById('fg');
                const prevGroup = fg.value;
                fg.innerHTML = '<option value="">No Group</option>';
                groups.forEach(g => fg.innerHTML += \`<option value="\${g}">\${g}</option>\`);
                if (prevGroup) fg.value = prevGroup;
            }
            
            const gf = document.getElementById('groups-filter');
            gf.innerHTML = '';
            const all = document.createElement('div');
            all.className = 'group-badge' + (filter === 'all' ? ' active' : '');
            all.textContent = \`All (\${apps.length})\`;
            all.onclick = () => { filter = 'all'; updateUI(); };
            gf.appendChild(all);
            
            groups.forEach(g => {
                const cnt = apps.filter(a => a.group === g).length;
                const badge = document.createElement('div');
                const isHid = hiddenGroups.has(g);
                badge.className = 'group-badge' + (filter === g ? ' active' : '');
                if (isHid) badge.style.opacity = '0.5';
                const link = groupLinks[g];
                const linkHtml = link ? \` <span style="cursor:pointer;font-size:12px;margin-left:4px" class="glink" onclick="event.stopPropagation(); copyGroupLink('\${g.replace(/'/g, "\\'")}')" title="Copy this group's client link">🔗</span>\` : '';
                badge.innerHTML = \`\${g} (\${cnt})\${isHid?' 🚫':''}\${linkHtml} <span style="cursor:pointer;opacity:0;transition:opacity .2s;font-size:11px;margin-left:4px" class="ghide" onclick="event.stopPropagation(); toggleGroupHidden('\${g}')" title="\${isHid?'Show':'Hide from extension'}">\${isHid?'👁️':'🙈'}</span> <span class="group-delete" onclick="event.stopPropagation(); deleteGroup('\${g}')">×</span>\`;
                badge.onclick = () => { filter = g; updateUI(); };
                badge.onmouseenter = () => { const h = badge.querySelector('.ghide'); if(h) h.style.opacity='1'; };
                badge.onmouseleave = () => { const h = badge.querySelector('.ghide'); if(h) h.style.opacity='0'; };
                gf.appendChild(badge);
            });
            
            renderBooked();
            filterApplicants();
        }

        // In-progress = an armed applicant a browser has claimed but not yet
        // booked. Derived live from afState, so it auto-clears on disarm/expiry.
        // Purely a visual marker — it never locks anything; Edit/click still work.
        function inProgressPassports() {
            const set = {};
            if (afState && Array.isArray(afState.order)) {
                afState.order.forEach(o => { if (o.claimedBy && !o.booked) set[o.passport] = true; });
            }
            return set;
        }

        function renderBooked() {
            const booked = apps.filter(a => String(a.status||'').toUpperCase() === 'PAYMENT');
            const panel = document.getElementById('booked-panel');
            if (!panel) return;
            panel.style.display = booked.length ? 'block' : 'none';
            const cnt = document.getElementById('booked-count');
            if (cnt) cnt.textContent = booked.length + (booked.length === 1 ? ' appointment' : ' appointments');
            const list = document.getElementById('booked-list');
            if (!list) return;
            list.innerHTML = booked.map(a => {
                const name = ((a.FirstName||'') + ' ' + (a.LastName||'')).trim() || a.PassportNo || '?';
                const photo = a.photo
                    ? '<img src="' + a.photo + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex:0 0 auto">'
                    : '<span style="width:26px;height:26px;border-radius:50%;background:#123;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex:0 0 auto">👤</span>';
                const grp = a.group ? '<span style="opacity:.65;font-size:11px">· ' + a.group + '</span>' : '';
                return '<span style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:22px;background:rgba(22,163,74,.16);border:1px solid rgba(22,163,74,.35);color:#dcfce7;font-size:13px;font-weight:700">' +
                       photo + '<span>' + name + ' <span style="opacity:.7;font-weight:600">' + (a.PassportNo||'') + '</span> ' + grp + '</span></span>';
            }).join('');
        }

        function filterApplicants() {
            const inProg = inProgressPassports();
            const q = document.getElementById('search').value.toLowerCase();
            let filtered = apps.filter(a => {
                if (filter !== 'all' && a.group !== filter) return false;
                if (!q) return true;
                return (a.FirstName || '').toLowerCase().includes(q) ||
                       (a.LastName  || '').toLowerCase().includes(q) ||
                       (a.PassportNo || '').toLowerCase().includes(q);
            });
            
            const tb = document.getElementById('tbody');
            if (!filtered.length) {
                tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📭</div><p>No applicants found</p></div></td></tr>';
                return;
            }
            
            // One applicant row. opts.hidden marks family members, revealed by
            // clicking their family header.
            function rowHtml(a, opts) {
                const idx = apps.indexOf(a);
                const o = opts || {};
                const cls = o.famKey ? ' class="fam-member fam-' + o.famKey + '"' : '';
                // Family members carry the family's violet identity so they are
                // visually part of it, not loose rows that happen to sit below.
                const famStyle = 'display:none;background:rgba(139,92,246,.14);box-shadow:inset 4px 0 0 #8b5cf6;';
                const famStyleOpen = 'background:rgba(139,92,246,.14);box-shadow:inset 4px 0 0 #8b5cf6;';
                const style = o.famKey
                    ? ' style="' + (o.hidden ? famStyle : famStyleOpen) + '"'
                    : (o.hidden ? ' style="display:none"' : '');
                const indent = o.famKey ? 'padding-left:26px;' : '';
                return \`<tr\${cls}\${style}>
                    <td style="\${indent}">\${a.photo ? \`<img class="photo-thumb" src="\${a.photo}">\` : '<div class="no-photo">👤</div>'}</td>
                    <td><strong>\${a.FirstName || ''} \${a.LastName || ''}</strong>\${String(a.status||'').toUpperCase()==='PAYMENT' ? ' <span style="display:inline-block;background:#16a34a;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;letter-spacing:.5px;vertical-align:middle">PAYMENT</span>' : (inProg[a.PassportNo] ? ' <span style="display:inline-block;background:#2563eb;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;letter-spacing:.4px;vertical-align:middle">IN PROGRESS</span>' : '')}</td>
                    <td>\${a.PassportNo || ''}</td>
                    <td>\${a.DateOfBirth || '-'}</td>
                    <td>\${a.PlaceOfBirth || '-'}\${(a.City || a.PostalCode) ? \`<br><small style="opacity:.65">🏠 \${[a.City, a.PostalCode].filter(Boolean).join(', ')}</small>\` : ''}</td>
                    <td>\${a.group ? '<span class="group-badge">' + a.group + '</span>' : '-'}\${String(a.familyName || '').trim() ? '<br><small style="opacity:.8">👨‍👩‍👧 ' + a.familyName + '</small>' : ''}</td>
                    <td class="actions">
                        \${IS_CLIENT ? '' : afToggleBtn(a)}
                        <button class="icon-btn" onclick="edit(\${idx})">✏️ Edit</button>
                        <button class="icon-btn" onclick="del(\${idx})">🗑️ Delete</button>
                    </td>
                </tr>\`;
            }

            // While searching, show a flat list — a member inside a collapsed
            // family would otherwise be invisible even though it matched.
            if (q) {
                tb.innerHTML = filtered.map(a => rowHtml(a)).join('');
                return;
            }

            // Collapse families (group + familyName) into one clickable header
            // row; individuals render as normal rows.
            const fams = new Map(), singles = [];
            filtered.forEach(a => {
                const f = String(a.familyName || '').trim().toUpperCase();
                if (!f) { singles.push(a); return; }
                const key = (a.group || '') + '||' + f;
                if (!fams.has(key)) fams.set(key, { name: f, group: a.group || '', members: [] });
                fams.get(key).members.push(a);
            });

            // Which families are expanded, keyed by group||name so the state
            // survives the 10-second auto-refresh (which rebuilds this table)
            // and isn't tied to a render index that can shift.
            window.openFams = window.openFams || new Set();

            let html = '';
            let fi = 0;
            [...fams.values()]
                .sort((x, y) => (x.group + x.name).localeCompare(y.group + y.name))
                .forEach(fam => {
                    const key = 'f' + (fi++);
                    const stable = fam.group + '||' + fam.name;
                    const isOpen = window.openFams.has(stable);
                    const photos = fam.members.filter(m => m.photo).length;
                    html += \`<tr class="fam-header" data-fam="\${key}" data-stable="\${stable.replace(/"/g, '&quot;')}" style="cursor:pointer;background:#6d28d9;color:#fff">
                        <td style="font-size:20px">👨‍👩‍👧</td>
                        <td colspan="4"><strong style="font-size:15px;color:#fff;letter-spacing:.5px">\${fam.name}</strong>
                            <span style="opacity:.85;color:#e9d5ff"> — \${fam.members.length} applicant\${fam.members.length > 1 ? 's' : ''}\${photos ? ' · ' + photos + ' 📷' : ''}</span>
                            <span class="fam-caret" style="margin-left:8px;color:#fff">\${isOpen ? '▼' : '▶'}</span></td>
                        <td>\${fam.group ? '<span class="group-badge">' + fam.group + '</span>' : '-'}</td>
                        <td class="actions"><span style="opacity:.8;font-size:11px;color:#e9d5ff">click to open</span></td>
                    </tr>\`;
                    html += fam.members.map(m => rowHtml(m, { famKey: key, hidden: !isOpen })).join('');
                });
            html += singles.map(a => rowHtml(a)).join('');
            tb.innerHTML = html;

            // Expand / collapse
            tb.querySelectorAll('.fam-header').forEach(hdr => {
                hdr.addEventListener('click', () => {
                    const key = hdr.dataset.fam;
                    const stable = hdr.dataset.stable;
                    const rows = tb.querySelectorAll('.fam-' + key);
                    const open = rows.length && rows[0].style.display !== 'none';
                    rows.forEach(r => r.style.display = open ? 'none' : 'table-row');
                    const caret = hdr.querySelector('.fam-caret');
                    if (caret) caret.textContent = open ? '▶' : '▼';
                    if (open) window.openFams.delete(stable); else window.openFams.add(stable);
                });
            });
        }

        // ── FAMILY GROUPING ────────────────────────────────────────────
        // familyName is optional. Empty = individual, which is the default and
        // what every pre-existing applicant already is. A family is identified
        // by group + familyName, so the same name in two groups stays separate.
        function onTypeChange() {
            const isFam = document.getElementById('ftype-fam').checked;
            document.getElementById('fam-wrap').style.display = isFam ? '' : 'none';
            if (isFam) { refreshFamilyList(); setTimeout(() => document.getElementById('ffam').focus(), 50); }
            else document.getElementById('ffam').value = '';
        }

        // Offer every family that already exists in the currently selected group,
        // so members 2..N are picked from the list instead of retyped.
        function refreshFamilyList() {
            const g = document.getElementById('fg').value;
            const names = [...new Set(apps
                .filter(a => (a.group || '') === g && String(a.familyName || '').trim())
                .map(a => String(a.familyName).trim()))].sort();
            document.getElementById('fam-options').innerHTML =
                names.map(nm => '<option value="' + nm.replace(/"/g, '&quot;') + '">').join('');
        }

        function showAddModal() {
            isModalOpen = true; // FIX: pause auto-refresh while editing
            editIdx = -1;
            currentPhotoBase64 = null;
            document.getElementById('modal-title').textContent = 'Add New Applicant';
            document.getElementById('fg').value = IS_CLIENT ? CLIENT_GROUP : (filter === 'all' ? '' : filter);
            ['ff','fl','fp','fd','fb','fi','fa1','fc','fpc','fph','ffam'].forEach(id => document.getElementById(id).value = '');
            // Default is ALWAYS Individual — most applicants are, so it is never re-selected by hand
            document.getElementById('ftype-indv').checked = true;
            onTypeChange();
            refreshFamilyList();
            document.getElementById('prev').innerHTML = '';
            document.getElementById('upload-status').style.display = 'none';
            document.getElementById('save-btn').disabled = false;
            document.getElementById('modal').classList.add('active');
            setTimeout(() => document.getElementById('ff').focus(), 100);
        }

        function edit(i) {
            isModalOpen = true; // FIX: pause auto-refresh while editing
            editIdx = i;
            currentPhotoBase64 = apps[i].photo;
            const a = apps[i];
            document.getElementById('modal-title').textContent = 'Edit Applicant';
            document.getElementById('fg').value = a.group || '';
            document.getElementById('ff').value = a.FirstName || '';
            document.getElementById('fl').value = a.LastName  || '';
            document.getElementById('fp').value = a.PassportNo || '';
            document.getElementById('fd').value = a.DateOfBirth || '';
            document.getElementById('fb').value = a.PlaceOfBirth || '';
            document.getElementById('fi').value = a.IssuePlace || '';
            document.getElementById('fa1').value = a.HomeAddressLine1 || '';
            document.getElementById('fc').value = a.City || '';
            document.getElementById('fpc').value = a.PostalCode || '';
            document.getElementById('fph').value = '';
            const fam = String(a.familyName || '').trim();
            document.getElementById('ftype-fam').checked  = !!fam;
            document.getElementById('ftype-indv').checked = !fam;
            document.getElementById('ffam').value = fam;
            document.getElementById('fam-wrap').style.display = fam ? '' : 'none';
            refreshFamilyList();
            document.getElementById('prev').innerHTML = a.photo
                ? \`<img src="\${a.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">\`
                : '';
            try { document.getElementById('photo-drop-plus').style.display = a.photo ? 'none' : ''; } catch(_) {}
            document.getElementById('upload-status').style.display = 'none';
            document.getElementById('save-btn').disabled = false;
            document.getElementById('modal').classList.add('active');
        }

        function closeModal() {
            isModalOpen = false;
            document.getElementById('modal').classList.remove('active');
            document.getElementById('prev').innerHTML = '';
            currentPhotoBase64 = null;
            try { document.getElementById('photo-drop-plus').style.display = ''; } catch(_) {}
        }

        document.getElementById('fph').onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const statusEl = document.getElementById('upload-status');
            const prevEl   = document.getElementById('prev');
            
            statusEl.style.display = 'block';
            statusEl.textContent = '⏳ Processing photo (High Quality)...';
            statusEl.style.background = '#fff3cd';
            statusEl.style.color = '#856404';
            
            try {
                const compressed = await compressImage(file, 600, 600, 0.92);
                currentPhotoBase64 = compressed;
                const sizeKB = Math.round((compressed.length * 3 / 4) / 1024);
                statusEl.textContent = \`✅ Photo optimized to ~\${sizeKB}KB (High Quality)!\`;
                statusEl.style.background = '#d4edda';
                statusEl.style.color = '#155724';
                prevEl.innerHTML = \`<img src="\${compressed}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">\`;
                try { document.getElementById('photo-drop-plus').style.display = 'none'; } catch(_) {}
            } catch (error) {
                console.error('Optimization error:', error);
                statusEl.textContent = '❌ Optimization failed! Try again.';
                statusEl.style.background = '#f8d7da';
                statusEl.style.color = '#721c24';
                currentPhotoBase64 = null;
            }
        };

        function compressImage(file, maxWidth, maxHeight, quality) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width, height = img.height;
                        if (width > height) {
                            if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
                        } else {
                            if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        async function save() {
            const saveBtn = document.getElementById('save-btn');
            const passportVal = document.getElementById('fp').value.trim();
            const firstVal   = document.getElementById('ff').value.trim();
            const lastVal    = document.getElementById('fl').value.trim();

            if (!firstVal || !lastVal || !passportVal) {
                toast('Please fill all required fields!', 'error');
                return;
            }

            // DOB validation — year must be 4 digits, between 1920 and now
            const dobVal = document.getElementById('fd').value;
            if (dobVal) {
                const parts = dobVal.split(/[-\\/]/);
                const year = parseInt(parts[0], 10);
                const now = new Date().getFullYear();
                if (isNaN(year) || year < 1920 || year > now || String(parts[0]).length !== 4) {
                    toast('Invalid year in Date of Birth! Must be 4 digits between 1920-' + now, 'error');
                    document.getElementById('fd').style.borderColor = '#f43f5e';
                    document.getElementById('fd').focus();
                    return;
                }
                document.getElementById('fd').style.borderColor = '';
            }

            // FIX: Check for duplicate passport only on NEW applicants
            if (editIdx < 0) {
                const duplicate = apps.find(a => a.PassportNo === passportVal);
                if (duplicate) {
                    toast(\`Passport \${passportVal} already exists!\`, 'error');
                    return;
                }
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '⏳ Saving...';

            // FIX: Stamp each applicant with _updatedAt so server can resolve conflicts
            const a = {
                group:       document.getElementById('fg').value,
                FirstName:   firstVal,
                LastName:    lastVal,
                PassportNo:  passportVal,
                DateOfBirth: document.getElementById('fd').value,
                PlaceOfBirth:document.getElementById('fb').value,
                IssuePlace:  document.getElementById('fi').value,
                HomeAddressLine1: document.getElementById('fa1').value.trim(),
                City:        document.getElementById('fc').value.trim(),
                PostalCode:  document.getElementById('fpc').value.trim(),
                familyName:  document.getElementById('ftype-fam').checked
                               ? document.getElementById('ffam').value.trim().toUpperCase()
                               : '',
                photo:       currentPhotoBase64,
                _updatedAt:  Date.now()   // FIX: timestamp for conflict resolution
            };

            // FIX: For edits, preserve original _updatedAt if newer (shouldn't happen, but safe)
            if (editIdx >= 0) {
                apps[editIdx] = a;
            } else {
                apps.push(a);
            }
            if (a.group && !groups.includes(a.group)) groups.push(a.group);

            try {
                await sync();
                closeModal();
                toast('✅ Applicant saved successfully!', 'success');
            } catch (e) {
                toast('❌ Save failed! Please try again.', 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '✓ Save Applicant';
            }
        }

        // FIX: Use atomic DELETE endpoint instead of full sync (prevents wiping others' data)
        async function del(i) {
            if (!confirm('Are you sure you want to delete this applicant?')) return;
            const passportNo = apps[i].PassportNo;
            if (!passportNo) {
                toast('Cannot delete: applicant has no passport number', 'error');
                return;
            }
            try {
                const r = await fetch(API + '/api/applicants/' + encodeURIComponent(passportNo), { method: 'DELETE' });
                if (!r.ok) throw new Error('Server error');
                const d = await r.json();
                apps   = d.data.applicants;
                groups = d.data.groups;
                updateUI();
                toast('Applicant deleted', 'success');
            } catch (e) {
                toast('Delete failed!', 'error');
            }
        }

        // FIX: Use the existing DELETE /api/applicants endpoint directly
        async function deleteAll() {
            if (!confirm('⚠️ Delete ALL applicants? This cannot be undone!')) return;
            try {
                await fetch(API + '/api/applicants', { method: 'DELETE' });
                apps = []; groups = [];
                filter = 'all';
                updateUI();
                toast('All applicants deleted', 'success');
            } catch (e) {
                toast('Delete failed!', 'error');
            }
        }

        // FIX: Use atomic group DELETE endpoint instead of full sync
        async function deleteGroup(groupName) {
            const count = apps.filter(a => a.group === groupName).length;
            if (!confirm(\`Delete group "\${groupName}" and \${count} applicant(s)?\`)) return;
            try {
                const r = await fetch(API + '/api/applicants/group/' + encodeURIComponent(groupName), { method: 'DELETE' });
                if (!r.ok) throw new Error('Server error');
                const d = await r.json();
                apps   = d.data.applicants;
                groups = d.data.groups;
                if (filter === groupName) filter = 'all';
                updateUI();
                toast('Group deleted', 'success');
            } catch (e) {
                toast('Delete failed!', 'error');
            }
        }

        function showAddGroupModal() {
            const name = prompt('Enter group name:');
            if (!name || !name.trim()) return;
            const g = name.trim();
            if (groups.includes(g)) { toast('Group already exists!', 'error'); return; }
            groups.push(g);
            sync();
            filter = g;
            toast('Group created!', 'success');
        }

        // sync() is now only used for add/edit and group creation (server merges, never overwrites)
        async function sync() {
            const r = await fetch(API + '/api/applicants/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicants: apps, groups })
            });
            if (!r.ok) throw new Error('Sync failed');
            const d = await r.json();
            // Update local state from authoritative server response
            apps   = d.data.applicants;
            groups = d.data.groups;
            updateUI();
        }

        // FIX: syncNow also broadcasts force-sync to extensions
        async function syncNow() {
            try {
                await loadData();
                // Notify all connected extensions to re-pull
                await fetch(API + '/api/force-sync', { method: 'POST' }).catch(() => {});
                toast('Synced successfully!', 'success');
            } catch (e) {
                toast('Sync failed!', 'error');
            }
        }

        function toggleExportDD() {
            const dd = document.getElementById('export-dd');
            dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        }
        document.addEventListener('click', e => {
            const dd = document.getElementById('export-dd');
            if (dd && dd.style.display === 'block' && !e.target.closest('[onclick*="toggleExportDD"]') && !e.target.closest('#export-dd')) dd.style.display = 'none';
        });

        function exportByCity(city) {
            document.getElementById('export-dd').style.display = 'none';
            const dateStr = new Date().toISOString().split('T')[0];
            let filtered, filename;
            if (city === 'ALL') {
                filtered = { applicants: apps, groups };
                filename = 'bls-ALL-' + dateStr + '.json';
            } else {
                const matchApps = apps.filter(a => (a.PlaceOfBirth || '').toUpperCase() === city.toUpperCase());
                const matchGroups = [...new Set(matchApps.map(a => a.group).filter(Boolean))];
                filtered = { applicants: matchApps, groups: matchGroups };
                filename = 'bls-' + city + '-' + dateStr + '.json';
            }
            const s = JSON.stringify(filtered, null, 2);
            const b = new Blob([s], { type: 'application/json' });
            const u = URL.createObjectURL(b);
            const l = document.createElement('a');
            l.href = u;
            l.download = filename;
            l.click();
            URL.revokeObjectURL(u);
            toast('Exported ' + filtered.applicants.length + ' applicants (' + city + ')', 'success');
        }

        function exportData() { exportByCity('ALL'); }

        // ── Group hide/show ──────────────────────────────────────────
        let hiddenGroups = new Set();

        // ── CLIENT PORTAL / ADMIN ───────────────────────────────────────
        const IS_CLIENT = window.__MODE === 'client';
        const CLIENT_GROUP = window.__GROUP || '';
        let groupLinks = {};

        async function loadGroupLinks() {
            if (IS_CLIENT) return;
            try {
                const r = await fetch(API + '/api/group-links');
                const d = await r.json();
                groupLinks = (d && d.links) || {};
            } catch (_) { groupLinks = {}; }
        }

        async function copyGroupLink(g) {
            const url = groupLinks[g];
            if (!url) return;
            try { await navigator.clipboard.writeText(url); toast('🔗 Link copied — send it to ' + g, 'success'); }
            catch (_) { prompt('Copy this link:', url); }
        }

        function applyModeUI() {
            // Warn the admin while the dashboard is unprotected
            if (!IS_CLIENT && !window.__AUTH) {
                const b = document.createElement('div');
                b.style.cssText = 'background:#7f1d1d;color:#fecaca;padding:12px 18px;font-size:13px;font-weight:600;font-family:system-ui;text-align:center;border-bottom:1px solid #b91c1c';
                b.innerHTML = '⚠️ This dashboard is open to anyone with the URL. In Railway → Variables add <code style="background:#450a0a;padding:2px 6px;border-radius:4px">ADMIN_KEY</code> to protect it and to enable per-group client links.';
                document.body.insertBefore(b, document.body.firstChild);
            }
            if (!IS_CLIENT) return;

            // Client mode: one group, nothing else reachable
            document.title = CLIENT_GROUP + ' — Applicants';
            const h1 = document.querySelector('.header h1');
            if (h1) h1.textContent = CLIENT_GROUP;
            const sub = document.querySelector('.header h1 + small, .header small');
            if (sub) sub.textContent = 'Add or edit the applicants for your group';

            // Admin-only controls
            const hide = sel => document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
            hide('#groups-filter');
            document.querySelectorAll('button').forEach(btn => {
                const t = (btn.textContent || '').trim();
                if (/Delete All|Force Sync/i.test(t)) btn.style.display = 'none';
            });

            // The group select is locked to this client's group
            const fg = document.getElementById('fg');
            if (fg) {
                fg.innerHTML = '<option value="' + CLIENT_GROUP.replace(/"/g, '&quot;') + '">' + CLIENT_GROUP + '</option>';
                fg.value = CLIENT_GROUP;
                fg.disabled = true;
                fg.style.opacity = '0.7';
            }
        }

        async function loadHiddenGroups() {
            try {
                const r = await fetch(API + '/api/hidden-groups');
                const d = await r.json();
                if (d.success) hiddenGroups = new Set(d.hidden);
            } catch(_) {}
        }

        async function toggleGroupHidden(g) {
            const action = hiddenGroups.has(g) ? 'show' : 'hide';
            try {
                const r = await fetch(API + '/api/hidden-groups', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, group: g })
                });
                const d = await r.json();
                if (d.success) {
                    hiddenGroups = new Set(d.hidden);
                    toast(g + (action === 'hide' ? ' hidden from extension' : ' visible to extension'), 'success');
                }
            } catch(e) { toast('Failed: ' + e.message, 'error'); }
            renderTable();
        }

        function importData() {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'application/json';
            inp.onchange = async e => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = async ev => {
                    try {
                        const d = JSON.parse(ev.target.result);
                        if (!d.applicants || !Array.isArray(d.applicants)) throw new Error('Invalid format');
                        // FIX: tag imported applicants with _updatedAt if missing
                        const now = Date.now();
                        const incoming = d.applicants.map(a => ({ ...a, group: IS_CLIENT ? CLIENT_GROUP : a.group, _updatedAt: a._updatedAt || now }));
                        const existingPassports = new Set(apps.map(a => a.PassportNo));
                        const newApps = incoming.filter(a => !existingPassports.has(a.PassportNo));
                        apps.push(...newApps);
                        if (d.groups && Array.isArray(d.groups)) {
                            d.groups.forEach(g => { if (!groups.includes(g)) groups.push(g); });
                        }
                        await sync();
                        toast(\`Imported \${newApps.length} applicant(s)!\`, 'success');
                    } catch (e) {
                        toast('Import failed! Invalid file format.', 'error');
                    }
                };
                r.readAsText(f);
            };
            inp.click();
        }

        function toast(msg, type = 'success') {
            const t = document.createElement('div');
            t.className = \`toast \${type}\`;
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 3000);
        }

        // ── ORDERED AUTO-FILL QUEUE (admin only) ────────────────────────
        let afQueue = [];          // passports, in the order the browsers will use
        let afState = null;        // last /state response
        let afPollTimer = null;

        function afToggleBtn(a) {
            const qi = afQueue.indexOf(a.PassportNo);
            const on = qi >= 0;
            return '<button class="icon-btn af-toggle" data-pp="' + encodeURIComponent(a.PassportNo) + '" style="' +
                   (on ? 'background:#f59e0b;color:#111;font-weight:800' : '') + '" title="Add to auto-fill order">' +
                   (on ? ('🎯 #' + (qi + 1)) : '🎯') + '</button>';
        }

        function toggleQueue(pp) {
            const i = afQueue.indexOf(pp);
            if (i >= 0) afQueue.splice(i, 1); else afQueue.push(pp);
            renderQueue();
            filterApplicants();   // refresh the 🎯 #n badges in the table
        }

        document.addEventListener('click', (e) => {
            const t = e.target.closest('.af-toggle, .af-remove');
            if (!t) return;
            e.preventDefault(); e.stopPropagation();
            toggleQueue(decodeURIComponent(t.getAttribute('data-pp')));
        });

        function nameFor(pp) {
            const a = apps.find(x => x.PassportNo === pp);
            return a ? ((a.FirstName || '') + ' ' + (a.LastName || '')).trim() || pp : pp;
        }

        function renderQueue() {
            const panel = document.getElementById('af-panel');
            if (IS_CLIENT) { if (panel) panel.style.display = 'none'; return; }
            if (panel) panel.style.display = afQueue.length ? 'block' : 'none';
            document.getElementById('af-count').textContent = afQueue.length ? '(' + afQueue.length + ')' : '';
            const list = document.getElementById('af-list');
            if (!list) return;
            const claimByPp = {};
            if (afState && afState.order) afState.order.forEach(r => claimByPp[r.passport] = r);
            list.innerHTML = afQueue.map((pp, i) => {
                const r = claimByPp[pp] || {};
                const isBooked = r.booked || String((apps.find(x=>x.PassportNo===pp)||{}).status||'').toUpperCase()==='PAYMENT';
                const claimed = r.claimedBy;
                const bg = isBooked ? '#16a34a' : claimed ? '#3b82f6' : 'rgba(245,158,11,.18)';
                const col = (isBooked || claimed) ? '#fff' : '#fbbf24';
                const tag = isBooked ? ' ✅ booked' : claimed ? ' 🔒 taken' : '';
                return '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;background:' + bg + ';color:' + col + ';font-size:13px;font-weight:700;border:1px solid rgba(255,255,255,.12)">' +
                       '<b>#' + (i + 1) + '</b> ' + nameFor(pp) + tag +
                       '<span class="af-remove" data-pp="' + encodeURIComponent(pp) + '" style="cursor:pointer;opacity:.7;margin-left:2px">✕</span></span>';
            }).join('');
        }

        async function armQueue() {
            if (!afQueue.length) { toast('Pick applicants with 🎯 first', 'error'); return; }
            try {
                const r = await fetch(API + '/api/autofill/arm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: afQueue, minutes: 45 }) });
                if (!r.ok) throw new Error();
                toast('🎯 Armed ' + afQueue.length + ' applicants — browsers will fill them in order', 'success');
                pollAfState();
            } catch (_) { toast('Arm failed', 'error'); }
        }
        async function disarmQueue() {
            try { await fetch(API + '/api/autofill/disarm', { method: 'POST' }); toast('Auto-fill disarmed', 'success'); pollAfState(); } catch (_) {}
        }

        async function pollAfState() {
            if (IS_CLIENT) return;
            try {
                const r = await fetch(API + '/api/autofill/state');
                afState = await r.json();
                // Restore the armed order after a page refresh: afQueue is in-memory
                // and resets to empty on reload, but the server is still armed. Load
                // it back ONCE so the chips + 🎯 badges reappear. Only on the first
                // poll, so it never fights the user's live edits afterwards.
                if (!window.__afRestored) {
                    window.__afRestored = true;
                    if (afState.active && Array.isArray(afState.order) && afState.order.length && !afQueue.length) {
                        afQueue = afState.order.map(o => o.passport);
                        filterApplicants();   // repaint the 🎯 #n badges in the table
                    }
                }
                const el = document.getElementById('af-status');
                if (el) {
                    if (afState.active) {
                        const claimed = afState.order.filter(o => o.claimedBy || o.booked).length;
                        const left = Math.max(0, Math.round((afState.expiresAt - Date.now()) / 60000));
                        el.textContent = '🟢 armed · ' + claimed + '/' + afState.order.length + ' done · ' + left + 'm left';
                        el.style.background = 'rgba(34,197,94,.18)'; el.style.color = '#4ade80';
                    } else {
                        el.textContent = 'idle'; el.style.background = 'rgba(255,255,255,.06)'; el.style.color = '#94a3b8';
                    }
                }
                renderQueue();
                // If the set of in-progress (claimed) applicants changed, repaint
                // the table so the IN PROGRESS badges update without a full reload.
                const sig = (afState.order || []).filter(o => o.claimedBy && !o.booked).map(o => o.passport).sort().join(',');
                if (sig !== window.__afProgSig) { window.__afProgSig = sig; filterApplicants(); }
            } catch (_) {}
        }

        document.addEventListener('DOMContentLoaded', async () => {
            await loadHiddenGroups();
            await loadGroupLinks();
            applyModeUI();
            loadData();
            if (!IS_CLIENT) { pollAfState(); afPollTimer = setInterval(pollAfState, 4000); }
            // Highlight filled selects with white border
            document.addEventListener('change', e => {
                if (e.target.tagName === 'SELECT' && e.target.closest('.form-group')) {
                    e.target.style.borderColor = e.target.value ? 'rgba(255,255,255,.35)' : '';
                }
            });
            document.addEventListener('input', e => {
                if (e.target.tagName === 'INPUT' && e.target.closest('.form-group')) {
                    e.target.style.borderColor = e.target.value.trim() ? 'rgba(255,255,255,.35)' : '';
                }
            });
        });

        // FIX: Auto-refresh every 10 seconds but ONLY when modal is not open
        setInterval(() => {
            if (!isModalOpen) loadData();
        }, 10000);
    </script>
</body>
</html>`;
  return html.replace('<head>', '<head>' + boot);
}

// Hidden groups management
app.get('/api/hidden-groups', (req, res) => {
  res.json({ success: true, hidden: [...hiddenGroups] });
});

app.post('/api/hidden-groups', requireAdmin, (req, res) => {
  const { action, group } = req.body || {};
  if (!group) return res.status(400).json({ success: false, error: 'group required' });
  if (action === 'hide') hiddenGroups.add(group);
  else if (action === 'show') hiddenGroups.delete(group);
  console.log(`Group "${group}" ${action === 'hide' ? 'HIDDEN' : 'SHOWN'} (hidden: ${[...hiddenGroups].join(', ')})`);
  res.json({ success: true, hidden: [...hiddenGroups] });
});

// Admin: the client link for every group (needs ADMIN_KEY to be set)
app.get('/api/group-links', requireAdmin, (req, res) => {
  if (!authEnabled()) return res.json({ enabled: false, links: {} });
  const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host');
  const links = {};
  allGroupNames().forEach(g => { links[g] = base + '/g/' + groupToken(g); });
  res.json({ enabled: true, links });
});

// ── CLIENT PORTAL API — every route is pinned to the token's group ────
function clientScope(req, res, next) {
  const group = groupForToken(req.params.token);
  if (!group) return res.status(404).json({ error: 'invalid link' });
  req.clientGroup = group;
  next();
}
const inGroup = (a, g) => (a.group || '') === g;

app.get('/g/:token/api/applicants', clientScope, (req, res) => {
  const g = req.clientGroup;
  res.json({
    applicants: sharedData.applicants.filter(a => inGroup(a, g)),
    groups: [g],
    lastModified: sharedData.lastModified
  });
});

// The client's dashboard talks to the same endpoints the admin one does,
// so mirror them — but every applicant is forced into the client's group,
// and nothing outside that group can be read, changed or deleted.
app.post('/g/:token/api/applicants/sync', clientScope, (req, res) => {
  const g = req.clientGroup;
  const incoming = Array.isArray(req.body.applicants) ? req.body.applicants : [];
  const pinned = incoming.map(a => ({ ...a, group: g }));

  const serverMap = new Map(sharedData.applicants.map(a => [a.PassportNo, a]));
  for (const a of pinned) {
    if (!a.PassportNo) continue;
    const existing = serverMap.get(a.PassportNo);
    // A passport that already belongs to ANOTHER group is not this client's to edit
    if (existing && !inGroup(existing, g)) continue;
    const now = Date.now();
    if (!existing) {
      serverMap.set(a.PassportNo, { ...a, _updatedAt: a._updatedAt || now, _createdAt: now, _photoUpdatedAt: a.photo ? now : 0 });
    } else if ((a._updatedAt || 0) >= (existing._updatedAt || 0)) {
      const photoChanged = a.photo !== existing.photo;
      serverMap.set(a.PassportNo, { ...a, _updatedAt: a._updatedAt || now, _createdAt: existing._createdAt || now, _photoUpdatedAt: photoChanged ? now : (existing._photoUpdatedAt || 0) });
    }
  }
  sharedData.applicants = Array.from(serverMap.values());
  if (!sharedData.groups.includes(g)) sharedData.groups.push(g);
  sharedData.lastModified = new Date().toISOString();

  res.json({
    success: true,
    data: { applicants: sharedData.applicants.filter(a => inGroup(a, g)), groups: [g] },
    stats: { totalApplicants: sharedData.applicants.filter(a => inGroup(a, g)).length, totalGroups: 1 }
  });
});

app.delete('/g/:token/api/applicants/:passportNo', clientScope, (req, res) => {
  const g = req.clientGroup;
  const pp = decodeURIComponent(req.params.passportNo);
  const target = sharedData.applicants.find(a => a.PassportNo === pp);
  if (!target || !inGroup(target, g)) return res.status(404).json({ error: 'not in your group' });
  sharedData._deletedSince = sharedData._deletedSince || [];
  sharedData._deletedSince.push({ passportNo: pp, ts: Date.now() });
  sharedData.applicants = sharedData.applicants.filter(a => a.PassportNo !== pp);
  sharedData.lastModified = new Date().toISOString();
  res.json({ success: true, data: { applicants: sharedData.applicants.filter(a => inGroup(a, g)), groups: [g] } });
});

// Admin-only features the shared dashboard JS may still call: make them inert
app.get('/g/:token/api/hidden-groups', clientScope, (req, res) => res.json({ hidden: [] }));
app.post('/g/:token/api/hidden-groups', clientScope, (req, res) => res.status(403).json({ error: 'not available' }));
app.delete('/g/:token/api/applicants/group/:groupName', clientScope, (req, res) => res.status(403).json({ error: 'not available' }));
app.delete('/g/:token/api/applicants', clientScope, (req, res) => res.status(403).json({ error: 'not available' }));
app.post('/g/:token/api/force-sync', clientScope, (req, res) => res.json({ success: true }));

// ── ORDERED AUTO-FILL QUEUE ──────────────────────────────────────────
// The admin arms an ordered list of applicants. When browsers win slots and
// land on ApplicantSelection they each claim the NEXT one not already booked
// (status PAYMENT) or claimed — first arrival gets #1. A booked applicant is
// skipped, so a teammate on the old extension who books someone (that person
// reaching PAYMENT) takes them out of the running automatically.
// State is in memory: a session, not durable — arming again resets it.
let autofill = { armed: false, order: [], claims: {}, armedAt: 0, expiresAt: 0 };

function booked(pp) {
  const a = sharedData.applicants.find(x => x.PassportNo === pp);
  return !!(a && String(a.status || '').toUpperCase() === 'PAYMENT');
}
function autofillActive() {
  return autofill.armed && Date.now() < autofill.expiresAt;
}
function applicantByPassport(pp) {
  return sharedData.applicants.find(x => x.PassportNo === pp) || null;
}

// Admin arms the queue with an ordered list of passports
app.post('/api/autofill/arm', requireAdmin, (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order.filter(Boolean) : [];
  const minutes = Math.min(Math.max(parseInt(req.body.minutes) || 45, 1), 240);
  autofill = { armed: order.length > 0, order, claims: {}, armedAt: Date.now(), expiresAt: Date.now() + minutes * 60000 };
  console.log(`🎯 Auto-fill ARMED: ${order.length} applicants, ${minutes} min`);
  res.json({ success: true, armed: autofill.armed, count: order.length, expiresAt: autofill.expiresAt });
});

app.post('/api/autofill/disarm', requireAdmin, (req, res) => {
  autofill.armed = false;
  console.log('🛑 Auto-fill DISARMED');
  res.json({ success: true });
});

// State — the dashboard polls this to show which slot each applicant holds
app.get('/api/autofill/state', (req, res) => {
  const active = autofillActive();
  const rows = autofill.order.map((pp, i) => {
    const c = autofill.claims[pp];
    return {
      passport: pp,
      index: i + 1,
      booked: booked(pp),
      claimedBy: c ? c.browserId : null,
      claimedAt: c ? c.ts : null
    };
  });
  res.json({ armed: autofill.armed, active, expiresAt: autofill.expiresAt, order: rows });
});

// A browser on ApplicantSelection claims its applicant. Idempotent: the same
// browserId always gets the same one back, so an F5 never skips ahead.
app.post('/api/autofill/claim', (req, res) => {
  if (!autofillActive()) return res.json({ armed: false });
  const browserId = String(req.body.browserId || '').trim();
  if (!browserId) return res.status(400).json({ error: 'browserId required' });

  // Already holds one? Return it (unless it got booked meanwhile → move on).
  for (const pp of autofill.order) {
    const c = autofill.claims[pp];
    if (c && c.browserId === browserId && !booked(pp)) {
      return res.json({ armed: true, passport: pp, index: autofill.order.indexOf(pp) + 1, applicant: applicantByPassport(pp) });
    }
  }

  // Otherwise take the first free, unbooked one in order.
  for (const pp of autofill.order) {
    if (booked(pp)) continue;
    const c = autofill.claims[pp];
    if (c && c.browserId !== browserId) continue;      // held by someone else
    autofill.claims[pp] = { browserId, ts: Date.now() };
    console.log(`  🎯 claim: ${browserId.slice(0,8)} → #${autofill.order.indexOf(pp)+1} ${pp}`);
    return res.json({ armed: true, passport: pp, index: autofill.order.indexOf(pp) + 1, applicant: applicantByPassport(pp) });
  }

  // Nothing left
  res.json({ armed: true, passport: null, exhausted: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', applicants: sharedData.applicants.length, groups: sharedData.groups.length });
});

// Returns full shared data including forceSyncTimestamp (used by extensions)
app.get('/api/applicants', (req, res) => {
  // Dashboard passes ?all=1 to see everything (including hidden groups).
  // Extensions don't pass this flag, so they get filtered data.
  // Extensions pass ?lite=1 for auto-sync — strips photos to save bandwidth.
  const isAll = req.query.all === '1' && isAdmin(req);
  const isLite = req.query.lite === '1';

  let data;
  if (isAll) {
    data = sharedData;
  } else {
    data = {
      ...sharedData,
      applicants: sharedData.applicants.filter(a => !a.group || !hiddenGroups.has(a.group)),
      groups: sharedData.groups.filter(g => !hiddenGroups.has(g))
    };
  }

  // ETag based on lastModified — if nothing changed, return 304
  const etag = '"' + (sharedData.lastModified || Date.now()) + '"';
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  // Lite mode: strip photos to save bandwidth (~97% reduction)
  if (isLite) {
    const liteData = {
      ...data,
      applicants: data.applicants.map(a => {
        const { photo, ...rest } = a;
        return rest;
      })
    };
    return res.json(liteData);
  }

  res.json(data);
});

// FIX (bandwidth reduction): tiny endpoint for force-sync polling.
// Extensions poll this every 2s just to check if the dashboard triggered
// a force-sync. Response is ~60 bytes vs several KB/MB for /api/applicants.
// Also returns lastModified so clients know when the actual data changed —
// they only re-fetch the full /api/applicants when either timestamp changes.
app.get('/api/sync-check', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    forceSyncTimestamp: sharedData.forceSyncTimestamp || 0,
    lastModified:       sharedData.lastModified       || null,
    applicantCount:     sharedData.applicants.length
  });
});

// ── DELTA SYNC: Only returns what changed since a timestamp ──
// Extension sends ?since=TIMESTAMP
// Server returns: { added: [...], updated: [...], deleted: ['passport1',...], lastSync: timestamp }
// - added: new applicants (WITH photos)
// - updated: modified applicants (with photo ONLY if photo changed)
// - deleted: passport numbers of removed applicants
app.get('/api/applicants/delta', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const filtered = sharedData.applicants.filter(a => !a.group || !hiddenGroups.has(a.group));

  if (since === 0) {
    // First sync — send everything with photos
    return res.json({
      added: filtered,
      updated: [],
      deleted: [],
      lastSync: Date.now(),
      full: true
    });
  }

  // Find applicants added or updated after 'since'
  const changed = filtered.filter(a => (a._updatedAt || 0) > since);

  // Separate into truly new (no _createdAt before since) and updated
  const added = [];
  const updated = [];
  changed.forEach(a => {
    if ((a._createdAt || a._updatedAt || 0) > since) {
      added.push(a); // New — include photo
    } else {
      // Updated — include photo only if _photoUpdatedAt > since
      if ((a._photoUpdatedAt || 0) > since) {
        updated.push(a); // Photo changed — include it
      } else {
        const { photo, ...rest } = a;
        updated.push(rest); // Text-only update — no photo
      }
    }
  });

  // Deleted applicants since timestamp
  const deleted = (sharedData._deletedSince || [])
    .filter(d => d.ts > since)
    .map(d => d.passportNo);

  res.json({
    added,
    updated,
    deleted,
    // Manifest of every passport the extension should hold right now.
    // `deleted` only lists deletions from the last hour (and none after a
    // restart), so a browser that missed the window would keep a removed
    // applicant forever. The client drops anything not in this list.
    passports: filtered.map(a => a.PassportNo).filter(Boolean),
    lastSync: Date.now(),
    full: false
  });
});

// FIX: MERGE instead of overwrite - the root cause fix
// Incoming applicants are upserted by PassportNo.
// Applicants already on server but NOT in payload are KEPT (not deleted).
// Conflict resolution: _updatedAt timestamp decides winner.
app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) return res.status(400).json({ error: 'Invalid: applicants must be an array' });

  // Build map of current server applicants
  const serverMap = new Map(sharedData.applicants.map(a => [a.PassportNo, a]));

  for (const incoming of applicants) {
    if (!incoming.PassportNo) continue; // skip entries with no passport key

    const existing = serverMap.get(incoming.PassportNo);

    if (!existing) {
      // New applicant — always add, mark creation time
      const now = Date.now();
      serverMap.set(incoming.PassportNo, {
        ...incoming,
        _updatedAt: incoming._updatedAt || now,
        _createdAt: now,
        _photoUpdatedAt: incoming.photo ? now : 0
      });
    } else {
      // Both sides have this passport: keep the more recently updated one
      const existingTime = existing._updatedAt  || 0;
      const incomingTime = incoming._updatedAt  || 0;
      if (incomingTime >= existingTime) {
        // Track if photo changed
        const photoChanged = incoming.photo !== existing.photo;
        serverMap.set(incoming.PassportNo, {
          ...incoming,
          _updatedAt: incomingTime || Date.now(),
          _createdAt: existing._createdAt || Date.now(),
          _photoUpdatedAt: photoChanged ? Date.now() : (existing._photoUpdatedAt || 0)
        });
      }
      // else: server version is newer — keep it, discard incoming
    }
  }

  sharedData.applicants = Array.from(serverMap.values());

  // Merge groups (union — never remove a group because a stale client didn't have it)
  const allGroups = new Set([...sharedData.groups, ...(groups || [])]);
  sharedData.groups = Array.from(allGroups);
  sharedData.lastModified = new Date().toISOString();

  res.json({
    success: true,
    data: sharedData,
    stats: { totalApplicants: sharedData.applicants.length, totalGroups: sharedData.groups.length }
  });
});

// FIX: Atomic group delete — safe, doesn't require client to send full applicant list
app.delete('/api/applicants/group/:groupName', requireAdmin, (req, res) => {
  const groupName = decodeURIComponent(req.params.groupName);
  const now = Date.now();
  // Track deleted passports for delta sync
  sharedData.applicants.filter(a => a.group === groupName).forEach(a => {
    if (a.PassportNo) sharedData._deletedSince.push({ passportNo: a.PassportNo, ts: now });
  });
  sharedData.applicants = sharedData.applicants.filter(a => a.group !== groupName);
  sharedData.groups     = sharedData.groups.filter(g => g !== groupName);
  sharedData.lastModified = new Date().toISOString();
  // Keep only last 1 hour of deletions
  sharedData._deletedSince = (sharedData._deletedSince || []).filter(d => d.ts > now - 3600000);
  res.json({ success: true, data: sharedData });
});

app.delete('/api/applicants/:passportNo', requireAdmin, (req, res) => {
  const passportNo = decodeURIComponent(req.params.passportNo);
  sharedData._deletedSince = sharedData._deletedSince || [];
  sharedData._deletedSince.push({ passportNo, ts: Date.now() });
  sharedData.applicants = sharedData.applicants.filter(a => a.PassportNo !== passportNo);
  sharedData.lastModified = new Date().toISOString();
  // Keep only last 1 hour
  sharedData._deletedSince = sharedData._deletedSince.filter(d => d.ts > Date.now() - 3600000);
  res.json({ success: true, data: sharedData });
});

app.delete('/api/applicants', requireAdmin, (req, res) => {
  const now = Date.now();
  sharedData.applicants.forEach(a => {
    if (a.PassportNo) sharedData._deletedSince.push({ passportNo: a.PassportNo, ts: now });
  });
  sharedData = {
    applicants: [],
    groups: [],
    lastModified: new Date().toISOString(),
    forceSyncTimestamp: sharedData.forceSyncTimestamp,
    _deletedSince: (sharedData._deletedSince || []).filter(d => d.ts > now - 3600000)
  };
  res.json({ success: true });
});

// FIX: Force sync endpoint — sets forceSyncTimestamp so polling extensions re-pull
app.post('/api/force-sync', requireAdmin, (req, res) => {
  sharedData.forceSyncTimestamp = Date.now();
  console.log('📢 Force sync triggered at', new Date().toISOString());
  res.json({ success: true, timestamp: sharedData.forceSyncTimestamp });
});

app.post('/api/broadcast', (req, res) => {
  const { location, visaType, timestamp } = req.body;
  if (!location || !visaType) {
    return res.status(400).json({ success: false, error: 'Missing location or visaType' });
  }
  currentCommand = { location, visaType, timestamp: timestamp || Date.now() };
  console.log('📢 Broadcast:', currentCommand);
  res.json({ success: true, command: currentCommand });
});

app.get('/api/broadcast', (req, res) => {
  res.json({ success: true, ...currentCommand });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Server on port ${PORT}`);
  console.log('🔀 Sync mode: MERGE by PassportNo (no more overwrites)');
  console.log('🗑️  Atomic deletes: single applicant + group endpoints');
  console.log('🔔 Force sync: POST /api/force-sync to push to all extensions');
  console.log('🔄 Dashboard: auto-refreshes every 10 seconds');
});
