const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString()
};

// Broadcast command storage
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
    <title>BLS Applicant Manager</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: white; border-radius: 12px; padding: 20px 30px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; }
        .header h1 { color: #667eea; font-size: 24px; }
        .sync-status { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #f0f4ff; border-radius: 8px; font-size: 14px; }
        .sync-dot { width: 10px; height: 10px; border-radius: 50%; background: #27ae60; }
        .card { background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .section-title { font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #2c3e50; }
        .btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .btn-primary { background: #667eea; color: white; }
        .btn-success { background: #27ae60; color: white; }
        .btn-danger { background: #e74c3c; color: white; }
        .btn-warning { background: #f39c12; color: white; }
        .toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .search-box { flex: 1; min-width: 200px; padding: 10px 15px; border: 2px solid #ecf0f1; border-radius: 8px; font-size: 14px; }
        .search-box:focus { outline: none; border-color: #667eea; }
        .groups-filter { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
        .group-badge { padding: 8px 16px; background: #ecf0f1; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
        .group-badge:hover { background: #667eea; color: white; }
        .group-badge.active { background: #667eea; color: white; }
        .group-delete { margin-left: 5px; color: #e74c3c; font-weight: bold; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ecf0f1; }
        th { background: #f8f9fa; font-weight: 600; color: #2c3e50; }
        tr:hover { background: #f8f9fa; }
        .photo-thumb { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #667eea; }
        .no-photo { width: 40px; height: 40px; border-radius: 50%; background: #ecf0f1; display: flex; align-items: center; justify-content: center; color: #95a5a6; font-size: 18px; }
        .actions { display: flex; gap: 8px; }
        .icon-btn { padding: 6px 12px; background: transparent; border: 1px solid #ecf0f1; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-size: 12px; }
        .icon-btn:hover { background: #f8f9fa; border-color: #667eea; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: white; border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
        .modal-header { padding: 20px 25px; border-bottom: 1px solid #ecf0f1; display: flex; justify-content: space-between; align-items: center; }
        .close-btn { background: none; border: none; font-size: 24px; color: #95a5a6; cursor: pointer; }
        .modal-body { padding: 25px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
        .form-group input, .form-group select { width: 100%; padding: 10px 12px; border: 2px solid #ecf0f1; border-radius: 8px; font-size: 14px; }
        .modal-footer { padding: 20px 25px; border-top: 1px solid #ecf0f1; display: flex; gap: 10px; justify-content: flex-end; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center; }
        .stat-card h3 { font-size: 32px; margin-bottom: 5px; }
        .stat-card p { font-size: 14px; opacity: 0.9; }
        .toast { position: fixed; bottom: 20px; right: 20px; padding: 15px 20px; background: #2c3e50; color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 2000; }
        .toast.success { background: #27ae60; }
        .toast.error { background: #e74c3c; }
        .empty-state { text-align: center; padding: 60px 20px; color: #95a5a6; }
        .upload-status { margin-top: 10px; padding: 8px; background: #f0f4ff; border-radius: 6px; font-size: 12px; color: #667eea; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div><h1>💼 BLS Applicant Manager</h1><small style="color: #7f8c8d;">☁️ Photos hosted FREE on ImgBB</small></div>
            <div style="display: flex; gap: 10px;">
                <div class="sync-status"><div class="sync-dot"></div><span>Ready</span></div>
                <button class="btn btn-warning" onclick="syncNow()">🔄 Sync</button>
            </div>
        </div>
        <div class="stats">
            <div class="stat-card"><h3 id="total-applicants">0</h3><p>Total Applicants</p></div>
            <div class="stat-card"><h3 id="total-groups">0</h3><p>Groups</p></div>
            <div class="stat-card"><h3 id="with-photos">0</h3><p>With Photos</p></div>
        </div>
        <div class="card">
            <div class="section-title">👥 Applicants</div>
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
            <div class="modal-header"><h2 id="modal-title">Add</h2><button class="close-btn" onclick="closeModal()">×</button></div>
            <div class="modal-body">
                <div class="form-group"><label>Group</label><select id="fg"><option value="">No Group</option></select></div>
                <div class="form-group"><label>First Name *</label><input type="text" id="ff"></div>
                <div class="form-group"><label>Last Name *</label><input type="text" id="fl"></div>
                <div class="form-group"><label>Passport *</label><input type="text" id="fp"></div>
                <div class="form-group"><label>Date of Birth</label><input type="date" id="fd"></div>
                <div class="form-group"><label>Place of Birth</label><select id="fb"><option value="">Select...</option><option>CASABLANCA</option><option>NADOR</option><option>RABAT</option><option>TETOUAN</option><option>AGADIR</option><option>TANGER</option></select></div>
                <div class="form-group"><label>Issue Place</label><select id="fi"><option value="">Select...</option><option>CASABLANCA</option><option>NADOR</option><option>RABAT</option><option>TETOUAN</option><option>AGADIR</option><option>TANGER</option></select></div>
                <div class="form-group">
                    <label>Photo (Any size - will auto-upload to ImgBB)</label>
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
    
    <script>
        const API = window.location.origin;
        const IMGBB_API_KEY = 'd2075c2e2e5f8b9c4e8f8e0a8c0f3b8e'; // Free ImgBB API key
        let apps = [], groups = [], editIdx = -1, filter = 'all';
        let currentPhotoUrl = null; // Store uploaded photo URL

        async function loadData() {
            try {
                const r = await fetch(API + '/api/applicants');
                const d = await r.json();
                apps = d.applicants || [];
                groups = d.groups || [];
                updateUI();
            } catch (e) { console.error('Load failed', e); }
        }

        function updateUI() {
            document.getElementById('total-applicants').textContent = apps.length;
            document.getElementById('total-groups').textContent = groups.length;
            document.getElementById('with-photos').textContent = apps.filter(a => a.photo).length;
            
            const fg = document.getElementById('fg');
            fg.innerHTML = '<option value="">No Group</option>';
            groups.forEach(g => fg.innerHTML += \`<option value="\${g}">\${g}</option>\`);
            
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
                       (a.LastName || '').toLowerCase().includes(q) ||
                       (a.PassportNo || '').toLowerCase().includes(q);
            });
            
            const tb = document.getElementById('tbody');
            if (!filtered.length) {
                tb.innerHTML = '<tr><td colspan="7"><div class="empty-state">No applicants</div></td></tr>';
                return;
            }
            
            tb.innerHTML = filtered.map((a, i) => {
                const idx = apps.indexOf(a);
                return \`<tr>
                    <td>\${a.photo ? \`<img class="photo-thumb" src="\${a.photo}" crossorigin="anonymous">\` : '<div class="no-photo">👤</div>'}</td>
                    <td>\${a.FirstName || ''} \${a.LastName || ''}</td>
                    <td>\${a.PassportNo || ''}</td>
                    <td>\${a.DateOfBirth || ''}</td>
                    <td>\${a.PlaceOfBirth || ''}</td>
                    <td>\${a.group || '-'}</td>
                    <td class="actions">
                        <button class="icon-btn" onclick="edit(\${idx})">✏️</button>
                        <button class="icon-btn" onclick="del(\${idx})">🗑️</button>
                    </td>
                </tr>\`;
            }).join('');
        }

        function showAddModal() {
            editIdx = -1;
            currentPhotoUrl = null;
            document.getElementById('modal-title').textContent = 'Add Applicant';
            document.getElementById('fg').value = filter === 'all' ? '' : filter;
            ['ff','fl','fp','fd','fb','fi','fph'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('prev').innerHTML = '';
            document.getElementById('upload-status').style.display = 'none';
            document.getElementById('modal').classList.add('active');
        }

        function edit(i) {
            editIdx = i;
            currentPhotoUrl = apps[i].photo; // Preserve existing photo URL
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
            document.getElementById('prev').innerHTML = a.photo ? \`<img src="\${a.photo}" crossorigin="anonymous" style="max-width:200px;margin-top:10px;border-radius:8px;">\` : '';
            document.getElementById('upload-status').style.display = 'none';
            document.getElementById('modal').classList.add('active');
        }

        function closeModal() {
            document.getElementById('modal').classList.remove('active');
        }

        // Auto-upload to ImgBB when photo selected
        document.getElementById('fph').onchange = async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            
            const statusEl = document.getElementById('upload-status');
            const prevEl = document.getElementById('prev');
            
            statusEl.style.display = 'block';
            statusEl.textContent = '⏳ Uploading to ImgBB...';
            statusEl.style.background = '#fff3cd';
            statusEl.style.color = '#856404';
            
            try {
                // Create form data
                const formData = new FormData();
                formData.append('image', f);
                
                // Upload to ImgBB
                const response = await fetch(\`https://api.imgbb.com/1/upload?key=\${IMGBB_API_KEY}\`, {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    currentPhotoUrl = result.data.url;
                    statusEl.textContent = '✅ Photo uploaded successfully!';
                    statusEl.style.background = '#d4edda';
                    statusEl.style.color = '#155724';
                    prevEl.innerHTML = \`<img src="\${currentPhotoUrl}" crossorigin="anonymous" style="max-width:200px;margin-top:10px;border-radius:8px;">\`;
                    console.log('Photo URL:', currentPhotoUrl);
                } else {
                    throw new Error('Upload failed');
                }
            } catch (error) {
                console.error('Upload error:', error);
                statusEl.textContent = '❌ Upload failed! Try again.';
                statusEl.style.background = '#f8d7da';
                statusEl.style.color = '#721c24';
                currentPhotoUrl = null;
            }
        };

        async function save() {
            const a = {
                group: document.getElementById('fg').value,
                FirstName: document.getElementById('ff').value.trim(),
                LastName: document.getElementById('fl').value.trim(),
                PassportNo: document.getElementById('fp').value.trim(),
                DateOfBirth: document.getElementById('fd').value,
                PlaceOfBirth: document.getElementById('fb').value,
                IssuePlace: document.getElementById('fi').value,
                photo: currentPhotoUrl // Use uploaded URL
            };
            
            if (!a.FirstName || !a.LastName || !a.PassportNo) { alert('Fill required!'); return; }
            
            if (editIdx >= 0) { apps[editIdx] = a; } else { apps.push(a); }
            if (a.group && !groups.includes(a.group)) groups.push(a.group);
            await sync();
            closeModal();
            toast('Saved!', 'success');
        }

        async function del(i) {
            if (!confirm('Delete?')) return;
            apps.splice(i, 1);
            await sync();
            toast('Deleted!', 'success');
        }

        async function deleteAll() {
            if (!confirm('Delete ALL?')) return;
            apps = []; groups = [];
            await sync();
            toast('All deleted!', 'success');
        }

        async function deleteGroup(groupName) {
            const count = apps.filter(a => a.group === groupName).length;
            if (!confirm(\`Delete "\${groupName}" and \${count} applicants?\`)) return;
            groups = groups.filter(g => g !== groupName);
            apps = apps.filter(a => a.group !== groupName);
            if (filter === groupName) filter = 'all';
            await sync();
            toast('Deleted!', 'success');
        }

        function showAddGroupModal() {
            const name = prompt('Group name:');
            if (!name || !name.trim()) return;
            const g = name.trim();
            if (groups.includes(g)) { toast('Exists!', 'error'); return; }
            groups.push(g);
            sync();
            filter = g;
            toast('Added!', 'success');
        }

        async function sync() {
            try {
                const r = await fetch(API + '/api/applicants/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ applicants: apps, groups })
                });
                const d = await r.json();
                apps = d.data.applicants;
                groups = d.data.groups;
                updateUI();
            } catch (e) { toast('Sync failed!', 'error'); }
        }

        async function syncNow() { await loadData(); toast('Synced!', 'success'); }

        function exportData() {
            const s = JSON.stringify({ applicants: apps, groups }, null, 2);
            const b = new Blob([s], { type: 'application/json' });
            const u = URL.createObjectURL(b);
            const l = document.createElement('a');
            l.href = u;
            l.download = \`bls-\${new Date().toISOString().split('T')[0]}.json\`;
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
                        if (!d.applicants || !Array.isArray(d.applicants)) throw new Error('Invalid');
                        const existingPassports = new Set(apps.map(a => a.PassportNo));
                        const newApps = d.applicants.filter(a => !existingPassports.has(a.PassportNo));
                        apps.push(...newApps);
                        if (d.groups && Array.isArray(d.groups)) {
                            d.groups.forEach(g => { if (!groups.includes(g)) groups.push(g); });
                        }
                        await sync();
                        toast(\`Imported \${newApps.length} new!\`, 'success');
                    } catch (e) { toast('Import failed!', 'error'); }
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
    </script>
</body>
</html>`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', applicants: sharedData.applicants.length, groups: sharedData.groups.length });
});

app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) return res.status(400).json({ error: 'Invalid' });
  
  sharedData.applicants = applicants;
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  
  res.json({ success: true, data: sharedData, stats: { totalApplicants: sharedData.applicants.length, totalGroups: sharedData.groups.length } });
});

app.delete('/api/applicants', (req, res) => {
  sharedData = { applicants: [], groups: [], lastModified: new Date().toISOString() };
  res.json({ success: true });
});

// Broadcast endpoints
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
  console.log('☁️ Photos hosted FREE on ImgBB!');
});
