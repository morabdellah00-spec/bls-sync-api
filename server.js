const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString(),
  version: 0
};

let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

function mergeApplicants(serverApps, clientApps) {
  const merged = [...serverApps];
  const serverPassports = new Set(serverApps.map(a => a.PassportNo));
  
  clientApps.forEach(clientApp => {
    if (clientApp.PassportNo && !serverPassports.has(clientApp.PassportNo)) {
      merged.push(clientApp);
    }
  });
  
  return merged;
}

// Serve the dashboard HTML from a separate file to avoid template literal issues
app.get('/', (req, res) => {
  res.send(getDashboardHTML());
});

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BLS Applicant Manager Pro</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1600px; margin: 0 auto; }
        .header {
            background: white;
            border-radius: 16px;
            padding: 25px 35px;
            margin-bottom: 25px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header-left h1 { color: #667eea; font-size: 28px; font-weight: 700; margin-bottom: 5px; }
        .header-left small { color: #7f8c8d; font-size: 13px; }
        .header-right { display: flex; gap: 15px; align-items: center; }
        .sync-status {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 25px;
            font-size: 14px;
            color: white;
            font-weight: 600;
        }
        .sync-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #27ae60;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.7; }
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 16px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            gap: 20px;
            transition: transform 0.3s;
        }
        .stat-card:hover { transform: translateY(-5px); }
        .stat-icon {
            width: 60px;
            height: 60px;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .stat-content h3 { font-size: 36px; font-weight: 700; color: #2c3e50; }
        .stat-content p { font-size: 14px; color: #7f8c8d; font-weight: 500; }
        .card { background: white; border-radius: 16px; padding: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); }
        .section-title {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 25px;
            color: #2c3e50;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .toolbar { display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap; }
        .search-box {
            flex: 1;
            min-width: 250px;
            padding: 12px 20px;
            border: 2px solid #e8ecf1;
            border-radius: 12px;
            font-size: 15px;
            background: #f8f9fa;
        }
        .search-box:focus { outline: none; border-color: #667eea; background: white; }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn:hover { transform: translateY(-2px); }
        .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .btn-success { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: white; }
        .btn-danger { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; }
        .btn-warning { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; }
        .groups-filter { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 25px; }
        .group-badge {
            padding: 10px 20px;
            background: #f8f9fa;
            border: 2px solid #e8ecf1;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .group-badge:hover { background: #667eea; color: white; }
        .group-badge.active { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .group-delete { color: #e74c3c; font-weight: bold; margin-left: 5px; cursor: pointer; }
        table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
        thead th {
            background: #f8f9fa;
            padding: 15px;
            text-align: left;
            font-weight: 700;
            color: #2c3e50;
            font-size: 13px;
            text-transform: uppercase;
        }
        tbody tr { background: white; transition: all 0.3s; }
        tbody tr:hover { background: #f8f9fa; transform: translateX(5px); }
        tbody td { padding: 15px; border-top: 1px solid #f1f3f5; border-bottom: 1px solid #f1f3f5; }
        tbody td:first-child { border-left: 1px solid #f1f3f5; border-radius: 12px 0 0 12px; }
        tbody td:last-child { border-right: 1px solid #f1f3f5; border-radius: 0 12px 12px 0; }
        .photo-thumb {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            object-fit: cover;
            border: 3px solid #667eea;
        }
        .no-photo {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            background: #f8f9fa;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #95a5a6;
            font-size: 24px;
        }
        .actions { display: flex; gap: 8px; }
        .icon-btn {
            padding: 8px 14px;
            background: #f8f9fa;
            border: 1px solid #e8ecf1;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
            font-size: 14px;
        }
        .icon-btn:hover { background: #667eea; color: white; }
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.6);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: white;
            border-radius: 20px;
            width: 100%;
            max-width: 700px;
            max-height: 90vh;
            overflow-y: auto;
        }
        .modal-header {
            padding: 25px 30px;
            border-bottom: 2px solid #f1f3f5;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px 20px 0 0;
        }
        .modal-header h2 { color: white; font-size: 24px; font-weight: 700; }
        .close-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            font-size: 28px;
            color: white;
            cursor: pointer;
            width: 40px;
            height: 40px;
            border-radius: 10px;
        }
        .close-btn:hover { background: rgba(255,255,255,0.3); }
        .modal-body { padding: 30px; }
        .form-group { margin-bottom: 20px; }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            font-size: 14px;
            color: #2c3e50;
        }
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 14px 18px;
            border: 2px solid #e8ecf1;
            border-radius: 12px;
            font-size: 15px;
            background: #f8f9fa;
        }
        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: #667eea;
            background: white;
        }
        .modal-footer {
            padding: 20px 30px;
            border-top: 2px solid #f1f3f5;
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            background: #f8f9fa;
            border-radius: 0 0 20px 20px;
        }
        .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 18px 24px;
            color: white;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            z-index: 2000;
            font-weight: 600;
        }
        .toast.success { background: #27ae60; }
        .toast.error { background: #e74c3c; }
        .toast.warning { background: #f39c12; }
        .empty-state { text-align: center; padding: 80px 20px; color: #95a5a6; }
        .upload-status {
            margin-top: 12px;
            padding: 12px;
            background: #f0f4ff;
            border-radius: 10px;
            font-size: 13px;
            color: #667eea;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-left">
                <h1>💼 BLS Applicant Manager Pro</h1>
                <small>📸 ~100KB | ⌨️ ENTER | 🔒 Multi-user safe</small>
            </div>
            <div class="header-right">
                <div class="sync-status">
                    <div class="sync-dot"></div>
                    <span id="sync-text">Ready</span>
                </div>
                <button class="btn btn-warning" onclick="syncNow()">🔄 Sync</button>
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-content">
                    <h3 id="total-applicants">0</h3>
                    <p>Total Applicants</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📁</div>
                <div class="stat-content">
                    <h3 id="total-groups">0</h3>
                    <p>Groups</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📸</div>
                <div class="stat-content">
                    <h3 id="with-photos">0</h3>
                    <p>With Photos</p>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="section-title"><span>👥</span><span>Applicants</span></div>
            <div class="toolbar">
                <input type="text" class="search-box" id="search" placeholder="🔍 Search..." oninput="filterApplicants()">
                <button class="btn btn-success" onclick="showAddModal()">➕ Add</button>
                <button class="btn btn-primary" onclick="showAddGroupModal()">📁 Group</button>
                <button class="btn btn-primary" onclick="importData()">📤 Import</button>
                <button class="btn btn-warning" onclick="exportData()">💾 Export</button>
                <button class="btn btn-danger" onclick="deleteAll()">🗑️ Delete All</button>
            </div>
            <div class="groups-filter" id="groups-filter"></div>
            <table>
                <thead><tr><th>Photo</th><th>Name</th><th>Passport</th><th>DOB</th><th>Place</th><th>Group</th><th>Actions</th></tr></thead>
                <tbody id="tbody"><tr><td colspan="7"><div class="empty-state">Loading...</div></td></tr></tbody>
            </table>
        </div>
    </div>
    
    <div id="modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modal-title">Add</h2>
                <button class="close-btn" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Group</label>
                    <select id="fg" onkeypress="handleEnter(event, 'ff')"><option value="">No Group</option></select>
                </div>
                <div class="form-group">
                    <label>First Name *</label>
                    <input type="text" id="ff" onkeypress="handleEnter(event, 'fl')">
                </div>
                <div class="form-group">
                    <label>Last Name *</label>
                    <input type="text" id="fl" onkeypress="handleEnter(event, 'fp')">
                </div>
                <div class="form-group">
                    <label>Passport *</label>
                    <input type="text" id="fp" onkeypress="handleEnter(event, 'fd')">
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="fd" onkeypress="handleEnter(event, 'fb')">
                </div>
                <div class="form-group">
                    <label>Place of Birth</label>
                    <select id="fb" onchange="autoFillIssuePlace()" onkeypress="handleEnter(event, 'fi')">
                        <option value="">Select...</option>
                        <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                        <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                        <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Issue Place</label>
                    <select id="fi" onkeypress="handleEnter(event, 'fph')">
                        <option value="">Select...</option>
                        <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                        <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                        <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Photo</label>
                    <input type="file" id="fph" accept="image/*">
                    <div id="upload-status" class="upload-status" style="display:none;"></div>
                    <div id="prev"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-danger" onclick="closeModal()">Cancel</button>
                <button class="btn btn-success" onclick="save()">Save</button>
            </div>
        </div>
    </div>
    
    <script src="/dashboard.js"></script>
</body>
</html>`;
}

// Serve JavaScript separately to avoid escaping issues
app.get('/dashboard.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(getDashboardJS());
});

function getDashboardJS() {
  return `
const API = window.location.origin;
let apps = [], groups = [], editIdx = -1, filter = 'all';
let currentPhoto = null;
let serverVersion = 0;

function autoFillIssuePlace() {
    const pb = document.getElementById('fb').value;
    const ip = document.getElementById('fi');
    if (pb && !ip.value) ip.value = pb;
}

function handleEnter(e, next) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const n = document.getElementById(next);
        if (n) n.focus();
        else save();
    }
}

async function loadData() {
    try {
        const r = await fetch(API + '/api/applicants');
        const d = await r.json();
        apps = d.applicants || [];
        groups = d.groups || [];
        serverVersion = d.version || 0;
        updateUI();
    } catch (e) { 
        console.error(e);
        toast('Load failed', 'error');
    }
}

function updateUI() {
    document.getElementById('total-applicants').textContent = apps.length;
    document.getElementById('total-groups').textContent = groups.length;
    document.getElementById('with-photos').textContent = apps.filter(a => a.photo).length;
    
    const fg = document.getElementById('fg');
    fg.innerHTML = '<option value="">No Group</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        fg.appendChild(opt);
    });
    
    const gf = document.getElementById('groups-filter');
    gf.innerHTML = '';
    const all = document.createElement('div');
    all.className = 'group-badge' + (filter === 'all' ? ' active' : '');
    all.textContent = 'All (' + apps.length + ')';
    all.onclick = () => { filter = 'all'; updateUI(); };
    gf.appendChild(all);
    
    groups.forEach(g => {
        const cnt = apps.filter(a => a.group === g).length;
        const badge = document.createElement('div');
        badge.className = 'group-badge' + (filter === g ? ' active' : '');
        
        const text = document.createElement('span');
        text.textContent = g + ' (' + cnt + ') ';
        badge.appendChild(text);
        
        const del = document.createElement('span');
        del.className = 'group-delete';
        del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); deleteGroup(g); };
        badge.appendChild(del);
        
        badge.onclick = () => { filter = g; updateUI(); };
        gf.appendChild(badge);
    });
    
    filterApplicants();
}

function filterApplicants() {
    const q = document.getElementById('search').value.toLowerCase();
    let filtered = apps.filter(a => {
        if (filter !== 'all' && a.group !== filter) return false;
        if (!q) return true;
        return (a.FirstName || '').toLowerCase().includes(q) ||
               (a.LastName || '').toLowerCase().includes(q) ||
               (a.PassportNo || '').toLowerCase().includes(q);
    });
    
    const tb = document.getElementById('tbody');
    if (!filtered.length) {
        tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">No applicants</div></td></tr>';
        return;
    }
    
    tb.innerHTML = '';
    filtered.forEach(a => {
        const idx = apps.indexOf(a);
        const tr = document.createElement('tr');
        
        tr.innerHTML = '<td>' + (a.photo ? '<img class="photo-thumb" src="' + a.photo + '">' : '<div class="no-photo">👤</div>') + '</td>' +
            '<td><strong>' + (a.FirstName || '') + ' ' + (a.LastName || '') + '</strong></td>' +
            '<td>' + (a.PassportNo || '') + '</td>' +
            '<td>' + (a.DateOfBirth || '-') + '</td>' +
            '<td>' + (a.PlaceOfBirth || '-') + '</td>' +
            '<td>' + (a.group || '-') + '</td>' +
            '<td class="actions">' +
            '<button class="icon-btn" onclick="edit(' + idx + ')">✏️</button>' +
            '<button class="icon-btn" onclick="del(' + idx + ')">🗑️</button>' +
            '</td>';
        
        tb.appendChild(tr);
    });
}

function showAddModal() {
    editIdx = -1;
    currentPhoto = null;
    document.getElementById('modal-title').textContent = 'Add Applicant';
    document.getElementById('fg').value = filter === 'all' ? '' : filter;
    ['ff','fl','fp','fd','fb','fi','fph'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('prev').innerHTML = '';
    document.getElementById('upload-status').style.display = 'none';
    document.getElementById('modal').classList.add('active');
    setTimeout(() => document.getElementById('fg').focus(), 100);
}

function edit(i) {
    editIdx = i;
    currentPhoto = apps[i].photo;
    const a = apps[i];
    document.getElementById('modal-title').textContent = 'Edit';
    document.getElementById('fg').value = a.group || '';
    document.getElementById('ff').value = a.FirstName || '';
    document.getElementById('fl').value = a.LastName || '';
    document.getElementById('fp').value = a.PassportNo || '';
    document.getElementById('fd').value = a.DateOfBirth || '';
    document.getElementById('fb').value = a.PlaceOfBirth || '';
    document.getElementById('fi').value = a.IssuePlace || '';
    document.getElementById('fph').value = '';
    document.getElementById('prev').innerHTML = a.photo ? '<img src="' + a.photo + '" style="max-width:200px;margin-top:10px;border-radius:12px;">' : '';
    document.getElementById('upload-status').style.display = 'none';
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

document.getElementById('fph').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusEl = document.getElementById('upload-status');
    const prevEl = document.getElementById('prev');
    
    statusEl.style.display = 'block';
    statusEl.textContent = '⏳ Processing...';
    
    try {
        const compressed = await compressImage(file, 600, 600, 0.92);
        currentPhoto = compressed;
        
        const sizeKB = Math.round((compressed.length * 3 / 4) / 1024);
        statusEl.textContent = '✅ ~' + sizeKB + 'KB!';
        prevEl.innerHTML = '<img src="' + compressed + '" style="max-width:200px;margin-top:10px;border-radius:12px;">';
    } catch (error) {
        statusEl.textContent = '❌ Failed';
        currentPhoto = null;
    }
};

function compressImage(file, maxW, maxH, q) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > h) {
                    if (w > maxW) { h *= maxW / w; w = maxW; }
                } else {
                    if (h > maxH) { w *= maxH / h; h = maxH; }
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', q));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function save() {
    const a = {
        group: document.getElementById('fg').value,
        FirstName: document.getElementById('ff').value.trim(),
        LastName: document.getElementById('fl').value.trim(),
        PassportNo: document.getElementById('fp').value.trim(),
        DateOfBirth: document.getElementById('fd').value,
        PlaceOfBirth: document.getElementById('fb').value,
        IssuePlace: document.getElementById('fi').value,
        photo: currentPhoto
    };
    
    if (!a.FirstName || !a.LastName || !a.PassportNo) {
        toast('Fill required!', 'error');
        return;
    }
    
    try {
        document.getElementById('sync-text').textContent = 'Saving...';
        
        const latest = await fetch(API + '/api/applicants');
        const latestData = await latest.json();
        
        apps = latestData.applicants || [];
        serverVersion = latestData.version || 0;
        
        const exists = apps.find((ap, i) => ap.PassportNo === a.PassportNo && i !== editIdx);
        if (exists) {
            toast('⚠️ Passport exists!', 'warning');
            document.getElementById('sync-text').textContent = 'Ready';
            return;
        }
        
        if (editIdx >= 0) {
            apps[editIdx] = a;
        } else {
            apps.push(a);
        }
        
        if (a.group && !groups.includes(a.group)) groups.push(a.group);
        
        await sync();
        closeModal();
        toast('✅ Saved!', 'success');
        document.getElementById('sync-text').textContent = 'Ready';
    } catch (e) {
        toast('❌ Failed!', 'error');
        document.getElementById('sync-text').textContent = 'Ready';
        console.error(e);
    }
}

async function del(i) {
    if (!confirm('Delete?')) return;
    apps.splice(i, 1);
    await sync();
    toast('Deleted', 'success');
}

async function deleteAll() {
    if (!confirm('Delete ALL?')) return;
    apps = []; groups = [];
    await sync();
    toast('All deleted', 'success');
}

async function deleteGroup(g) {
    const cnt = apps.filter(a => a.group === g).length;
    if (!confirm('Delete "' + g + '" (' + cnt + ')?')) return;
    groups = groups.filter(gr => gr !== g);
    apps = apps.filter(a => a.group !== g);
    if (filter === g) filter = 'all';
    await sync();
    toast('Deleted', 'success');
}

function showAddGroupModal() {
    const name = prompt('Group name:');
    if (!name || !name.trim()) return;
    const g = name.trim();
    if (groups.includes(g)) { toast('Exists!', 'error'); return; }
    groups.push(g);
    sync();
    filter = g;
    toast('Created!', 'success');
}

async function sync() {
    try {
        const r = await fetch(API + '/api/applicants/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicants: apps, groups, clientVersion: serverVersion })
        });
        const d = await r.json();
        
        if (d.merged) {
            toast('⚠️ Data merged!', 'warning');
        }
        
        apps = d.data.applicants;
        groups = d.data.groups;
        serverVersion = d.data.version;
        updateUI();
    } catch (e) {
        toast('Sync failed!', 'error');
        console.error(e);
    }
}

async function syncNow() {
    await loadData();
    toast('Synced!', 'success');
}

function exportData() {
    const s = JSON.stringify({ applicants: apps, groups }, null, 2);
    const b = new Blob([s], { type: 'application/json' });
    const u = URL.createObjectURL(b);
    const l = document.createElement('a');
    l.href = u;
    l.download = 'bls-' + new Date().toISOString().split('T')[0] + '.json';
    l.click();
    URL.revokeObjectURL(u);
    toast('Exported!', 'success');
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
                if (!d.applicants) throw new Error('Invalid');
                const existingPassports = new Set(apps.map(a => a.PassportNo));
                const newApps = d.applicants.filter(a => !existingPassports.has(a.PassportNo));
                apps.push(...newApps);
                if (d.groups) {
                    d.groups.forEach(g => { if (!groups.includes(g)) groups.push(g); });
                }
                await sync();
                toast('Imported ' + newApps.length + '!', 'success');
            } catch (e) {
                toast('Import failed!', 'error');
            }
        };
        r.readAsText(f);
    };
    inp.click();
}

function toast(msg, type) {
    type = type || 'success';
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', loadData);

setInterval(async () => {
    try {
        await loadData();
        console.log('Auto-refreshed');
    } catch(e) {}
}, 30000);
`;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', applicants: sharedData.applicants.length, groups: sharedData.groups.length, version: sharedData.version });
});

app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups, clientVersion } = req.body;
  if (!Array.isArray(applicants)) return res.status(400).json({ error: 'Invalid' });
  
  let merged = false;
  
  if (clientVersion && clientVersion < sharedData.version) {
    console.log('Merging data...');
    sharedData.applicants = mergeApplicants(sharedData.applicants, applicants);
    merged = true;
  } else {
    sharedData.applicants = applicants;
  }
  
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  sharedData.version++;
  
  res.json({ 
    success: true, 
    data: sharedData, 
    merged,
    stats: { totalApplicants: sharedData.applicants.length, totalGroups: sharedData.groups.length } 
  });
});

app.delete('/api/applicants', (req, res) => {
  sharedData = { applicants: [], groups: [], lastModified: new Date().toISOString(), version: 0 };
  res.json({ success: true });
});

app.post('/api/broadcast', (req, res) => {
  const { location, visaType, timestamp } = req.body;
  if (!location || !visaType) {
    return res.status(400).json({ success: false, error: 'Missing location or visaType' });
  }
  currentCommand = { location, visaType, timestamp: timestamp || Date.now() };
  res.json({ success: true, command: currentCommand });
});

app.get('/api/broadcast', (req, res) => {
  res.json({ success: true, ...currentCommand });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server on port ' + PORT);
  console.log('🔒 Multi-user safe | 📸 ~100KB photos | ⌨️ ENTER navigation');
});
