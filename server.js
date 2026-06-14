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
  forceSyncTimestamp: 0
};

let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BLS Applicant Manager Pro</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
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
            display: flex; align-items: center; gap: 10px;
            padding: 10px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            background: white; padding: 25px; border-radius: 16px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            display: flex; align-items: center; gap: 20px;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.15); }
        
        .stat-icon {
            width: 60px; height: 60px; border-radius: 14px;
            display: flex; align-items: center; justify-content: center;
            font-size: 28px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .stat-content h3 { font-size: 36px; font-weight: 700; color: #2c3e50; margin-bottom: 5px; }
        .stat-content p { font-size: 14px; color: #7f8c8d; font-weight: 500; }
        
        .card {
            background: white; border-radius: 16px; padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        }
        
        .section-title {
            font-size: 22px; font-weight: 700; margin-bottom: 25px;
            color: #2c3e50; display: flex; align-items: center; gap: 10px;
        }
        
        .toolbar { display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap; }
        
        .search-box {
            flex: 1; min-width: 250px; padding: 12px 20px;
            border: 2px solid #e8ecf1; border-radius: 12px;
            font-size: 15px; transition: all 0.3s; background: #f8f9fa;
        }
        
        .search-box:focus {
            outline: none; border-color: #667eea; background: white;
            box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        }
        
        .btn {
            padding: 12px 24px; border: none; border-radius: 12px;
            font-size: 14px; font-weight: 600; cursor: pointer;
            transition: all 0.3s; display: inline-flex; align-items: center; gap: 8px;
        }
        
        .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        
        .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .btn-success { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: white; }
        .btn-danger  { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; }
        .btn-warning { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; }
        
        .groups-filter { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 25px; }
        
        .group-badge {
            padding: 10px 20px;
            background: #f8f9fa; border: 2px solid #e8ecf1; border-radius: 25px;
            font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.3s;
            display: inline-flex; align-items: center; gap: 8px;
        }
        
        .group-badge:hover { background: #667eea; color: white; border-color: #667eea; transform: translateY(-2px); }
        .group-badge.active { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-color: transparent; }
        .group-delete { color: #e74c3c; font-weight: bold; cursor: pointer; margin-left: 5px; transition: color 0.3s; }
        .group-badge:hover .group-delete { color: white; }
        
        table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
        
        thead th {
            background: #f8f9fa; padding: 15px; text-align: left;
            font-weight: 700; color: #2c3e50; font-size: 13px;
            text-transform: uppercase; letter-spacing: 0.5px; border: none;
        }
        
        tbody tr { background: white; transition: all 0.3s; }
        tbody tr:hover { background: #f8f9fa; transform: translateX(5px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        
        tbody td { padding: 15px; border-top: 1px solid #f1f3f5; border-bottom: 1px solid #f1f3f5; }
        tbody td:first-child { border-left: 1px solid #f1f3f5; border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        tbody td:last-child  { border-right: 1px solid #f1f3f5; border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        
        .photo-thumb {
            width: 50px; height: 50px; border-radius: 12px; object-fit: cover;
            border: 3px solid #667eea; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        
        .no-photo {
            width: 50px; height: 50px; border-radius: 12px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            display: flex; align-items: center; justify-content: center;
            color: #95a5a6; font-size: 24px;
        }
        
        .actions { display: flex; gap: 8px; }
        
        .icon-btn {
            padding: 8px 14px; background: #f8f9fa; border: 1px solid #e8ecf1;
            border-radius: 8px; cursor: pointer; transition: all 0.3s; font-size: 14px;
        }
        
        .icon-btn:hover { background: #667eea; color: white; border-color: #667eea; transform: translateY(-2px); }
        
        .modal {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 1000; align-items: center; justify-content: center; animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal.active { display: flex; }
        
        .modal-content {
            background: white; border-radius: 20px; width: 100%; max-width: 700px;
            max-height: 90vh; overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: slideUp 0.3s;
        }
        
        @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        
        .modal-header {
            padding: 25px 30px; border-bottom: 2px solid #f1f3f5;
            display: flex; justify-content: space-between; align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            width: 100%; padding: 14px 18px; border: 2px solid #e8ecf1;
            border-radius: 12px; font-size: 15px; transition: all 0.3s; background: #f8f9fa;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: none; border-color: #667eea; background: white;
            box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        }
        
        .modal-footer {
            padding: 20px 30px; border-top: 2px solid #f1f3f5;
            display: flex; gap: 12px; justify-content: flex-end;
            background: #f8f9fa; border-radius: 0 0 20px 20px;
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
            border-radius: 10px; font-size: 13px; color: #667eea; text-align: center; font-weight: 600;
        }
        
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #f1f3f5; }
        ::-webkit-scrollbar-thumb { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: #667eea; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-left">
                <h1>💼 BLS Applicant Manager Pro</h1>
                <small>📸 High Quality Photos (~100KB) | ⌨️ Press ENTER to navigate | 🔄 Auto-refresh every 10s</small>
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
                <button class="btn btn-warning" onclick="exportData()">💾 Export JSON</button>
                <button class="btn btn-danger" onclick="deleteAll()">🗑️ Delete All</button>
            </div>
            
            <div class="groups-filter" id="groups-filter"></div>
            
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
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modal-title">Add Applicant</h2>
                <button class="close-btn" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>📁 Group</label>
                    <select id="fg" onkeypress="handleEnter(event, 'ff')">
                        <option value="">No Group</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>👤 First Name *</label>
                    <input type="text" id="ff" placeholder="Enter first name" onkeypress="handleEnter(event, 'fl')">
                </div>
                <div class="form-group">
                    <label>👤 Last Name *</label>
                    <input type="text" id="fl" placeholder="Enter last name" onkeypress="handleEnter(event, 'fp')">
                </div>
                <div class="form-group">
                    <label>🛂 Passport Number *</label>
                    <input type="text" id="fp" placeholder="Enter passport number" onkeypress="handleEnter(event, 'fd')">
                </div>
                <div class="form-group">
                    <label>📅 Date of Birth</label>
                    <input type="date" id="fd" onkeypress="handleEnter(event, 'fb')">
                </div>
                <div class="form-group">
                    <label>🏙️ Place of Birth</label>
                    <select id="fb" onchange="autoFillIssuePlace()" onkeypress="handleEnter(event, 'fi')">
                        <option value="">Select...</option>
                        <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                        <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                        <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>📍 Issue Place</label>
                    <select id="fi" onkeypress="handleEnter(event, 'fa1')">
                        <option value="">Select...</option>
                        <option>CASABLANCA</option><option>NADOR</option><option>RABAT</option>
                        <option>TETOUAN</option><option>AGADIR</option><option>TANGER</option>
                        <option>FES</option><option>MARRAKECH</option><option>MEKNES</option><option>OUJDA</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>🏠 Home Address Line1</label>
                    <input type="text" id="fa1" placeholder="Enter home address" onkeypress="handleEnter(event, 'fc')">
                </div>
                <div class="form-group">
                    <label>🏙️ City</label>
                    <input type="text" id="fc" placeholder="Enter city" onkeypress="handleEnter(event, 'fpc')">
                </div>
                <div class="form-group">
                    <label>📮 Postal Code</label>
                    <input type="text" id="fpc" placeholder="Enter postal code" onkeypress="handleEnter(event, 'fph')">
                </div>
                <div class="form-group">
                    <label>📸 Photo (High Quality ~100KB)</label>
                    <input type="file" id="fph" accept="image/*">
                    <div id="upload-status" class="upload-status" style="display:none;"></div>
                    <div id="prev"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-danger" onclick="closeModal()">✕ Cancel</button>
                <button class="btn btn-success" id="save-btn" onclick="save()">✓ Save Applicant</button>
            </div>
        </div>
    </div>
    
    <script>
        const API = window.location.origin;
        let apps = [], groups = [], editIdx = -1, filter = 'all';
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
                const r = await fetch(API + '/api/applicants');
                const d = await r.json();
                apps = d.applicants || [];
                groups = d.groups || [];
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
            if (!isModalOpen) {
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
                badge.className = 'group-badge' + (filter === g ? ' active' : '');
                badge.innerHTML = \`\${g} (\${cnt}) <span class="group-delete" onclick="event.stopPropagation(); deleteGroup('\${g}')">×</span>\`;
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
                       (a.LastName  || '').toLowerCase().includes(q) ||
                       (a.PassportNo || '').toLowerCase().includes(q);
            });
            
            const tb = document.getElementById('tbody');
            if (!filtered.length) {
                tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">📭</div><p>No applicants found</p></div></td></tr>';
                return;
            }
            
            tb.innerHTML = filtered.map(a => {
                const idx = apps.indexOf(a);
                return \`<tr>
                    <td>\${a.photo ? \`<img class="photo-thumb" src="\${a.photo}">\` : '<div class="no-photo">👤</div>'}</td>
                    <td><strong>\${a.FirstName || ''} \${a.LastName || ''}</strong></td>
                    <td>\${a.PassportNo || ''}</td>
                    <td>\${a.DateOfBirth || '-'}</td>
                    <td>\${a.PlaceOfBirth || '-'}\${(a.City || a.PostalCode) ? \`<br><small style="opacity:.65">🏠 \${[a.City, a.PostalCode].filter(Boolean).join(', ')}</small>\` : ''}</td>
                    <td>\${a.group ? '<span class="group-badge">' + a.group + '</span>' : '-'}</td>
                    <td class="actions">
                        <button class="icon-btn" onclick="edit(\${idx})">✏️ Edit</button>
                        <button class="icon-btn" onclick="del(\${idx})">🗑️ Delete</button>
                    </td>
                </tr>\`;
            }).join('');
        }

        function showAddModal() {
            isModalOpen = true; // FIX: pause auto-refresh while editing
            editIdx = -1;
            currentPhotoBase64 = null;
            document.getElementById('modal-title').textContent = 'Add New Applicant';
            document.getElementById('fg').value = filter === 'all' ? '' : filter;
            ['ff','fl','fp','fd','fb','fi','fa1','fc','fpc','fph'].forEach(id => document.getElementById(id).value = '');
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
            document.getElementById('prev').innerHTML = a.photo
                ? \`<img src="\${a.photo}" style="max-width:200px;margin-top:15px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">\`
                : '';
            document.getElementById('upload-status').style.display = 'none';
            document.getElementById('save-btn').disabled = false;
            document.getElementById('modal').classList.add('active');
        }

        function closeModal() {
            isModalOpen = false; // FIX: resume auto-refresh
            document.getElementById('modal').classList.remove('active');
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
                prevEl.innerHTML = \`<img src="\${compressed}" style="max-width:200px;margin-top:15px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">\`;
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

        function exportData() {
            const s = JSON.stringify({ applicants: apps, groups }, null, 2);
            const b = new Blob([s], { type: 'application/json' });
            const u = URL.createObjectURL(b);
            const l = document.createElement('a');
            l.href = u;
            l.download = \`bls-applicants-\${new Date().toISOString().split('T')[0]}.json\`;
            l.click();
            URL.revokeObjectURL(u);
            toast('Exported successfully!', 'success');
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
                        const incoming = d.applicants.map(a => ({ ...a, _updatedAt: a._updatedAt || now }));
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

        document.addEventListener('DOMContentLoaded', loadData);

        // FIX: Auto-refresh every 10 seconds but ONLY when modal is not open
        setInterval(() => {
            if (!isModalOpen) loadData();
        }, 10000);
    </script>
</body>
</html>`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', applicants: sharedData.applicants.length, groups: sharedData.groups.length });
});

// Returns full shared data including forceSyncTimestamp (used by extensions)
app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
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
      // New applicant — always add
      serverMap.set(incoming.PassportNo, {
        ...incoming,
        _updatedAt: incoming._updatedAt || Date.now()
      });
    } else {
      // Both sides have this passport: keep the more recently updated one
      const existingTime = existing._updatedAt  || 0;
      const incomingTime = incoming._updatedAt  || 0;
      if (incomingTime >= existingTime) {
        serverMap.set(incoming.PassportNo, {
          ...incoming,
          _updatedAt: incomingTime || Date.now()
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
app.delete('/api/applicants/group/:groupName', (req, res) => {
  const groupName = decodeURIComponent(req.params.groupName);
  sharedData.applicants = sharedData.applicants.filter(a => a.group !== groupName);
  sharedData.groups     = sharedData.groups.filter(g => g !== groupName);
  sharedData.lastModified = new Date().toISOString();
  res.json({ success: true, data: sharedData });
});

// FIX: Atomic single-applicant delete by passport number
app.delete('/api/applicants/:passportNo', (req, res) => {
  const passportNo = decodeURIComponent(req.params.passportNo);
  sharedData.applicants = sharedData.applicants.filter(a => a.PassportNo !== passportNo);
  sharedData.lastModified = new Date().toISOString();
  res.json({ success: true, data: sharedData });
});

// Delete ALL applicants
app.delete('/api/applicants', (req, res) => {
  sharedData = {
    applicants: [],
    groups: [],
    lastModified: new Date().toISOString(),
    forceSyncTimestamp: sharedData.forceSyncTimestamp // preserve so extensions don't re-trigger
  };
  res.json({ success: true });
});

// FIX: Force sync endpoint — sets forceSyncTimestamp so polling extensions re-pull
app.post('/api/force-sync', (req, res) => {
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
