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
        .sync-dot { width: 10px; height: 10px; border-radius: 50%; background: #27ae60; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
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
        .group-badge:hover { background: #667eea; color: white; transform: translateY(-1px); }
        .group-badge.active { background: #667eea; color: white; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ecf0f1; }
        th { background: #f8f9fa; font-weight: 600; color: #2c3e50; }
        tr:hover { background: #f8f9fa; }
        .photo-thumb { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #667eea; }
        .no-photo { width: 40px; height: 40px; border-radius: 50%; background: #ecf0f1; display: flex; align-items: center; justify-content: center; color: #95a5a6; font-size: 18px; }
        .actions { display: flex; gap: 8px; }
        .icon-btn { padding: 6px 12px; background: transparent; border: 1px solid #ecf0f1; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-size: 12px; }
        .icon-btn:hover { background: #f8f9fa; border-color: #667eea; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px; }
        .modal.active { display: flex; }
        .modal-content { background: white; border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
        .modal-header { padding: 20px 25px; border-bottom: 1px solid #ecf0f1; display: flex; justify-content: space-between; align-items: center; }
        .close-btn { background: none; border: none; font-size: 24px; color: #95a5a6; cursor: pointer; width: 30px; height: 30px; }
        .close-btn:hover { background: #ecf0f1; border-radius: 50%; }
        .modal-body { padding: 25px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 14px; }
        .form-group input, .form-group select { width: 100%; padding: 10px 12px; border: 2px solid #ecf0f1; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #667eea; }
        .modal-footer { padding: 20px 25px; border-top: 1px solid #ecf0f1; display: flex; gap: 10px; justify-content: flex-end; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center; }
        .stat-card h3 { font-size: 32px; margin-bottom: 5px; }
        .stat-card p { font-size: 14px; opacity: 0.9; }
        .toast { position: fixed; bottom: 20px; right: 20px; padding: 15px 20px; background: #2c3e50; color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 2000; animation: slideIn 0.3s ease; }
        @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .toast.success { background: #27ae60; }
        .toast.error { background: #e74c3c; }
        .empty-state { text-align: center; padding: 60px 20px; color: #95a5a6; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div><h1>💼 BLS Applicant Manager</h1><small style="color: #7f8c8d;">Web Dashboard</small></div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <div class="sync-status"><div class="sync-dot"></div><span>Connected</span></div>
                <button class="btn btn-warning" onclick="syncNow()">🔄 Sync</button>
            </div>
        </div>
        <div class="stats">
            <div class="stat-card"><h3 id="total-applicants">0</h3><p>Total Applicants</p></div>
            <div class="stat-card"><h3 id="total-groups">0</h3><p>Groups</p></div>
            <div class="stat-card"><h3 id="with-photos">0</h3><p>With Photos</p></div>
        </div>
        <div class="card">
            <div class="section-title">👥 Applicants Management</div>
            <div class="toolbar">
                <input type="text" class="search-box" id="search" placeholder="🔍 Search..." oninput="filterApplicants()">
                <button class="btn btn-success" onclick="showAddModal()">➕ Add</button>
                <button class="btn btn-primary" onclick="showAddGroupModal()">📁 Add Group</button>
                <button class="btn btn-primary" onclick="importData()">📤 Import</button>
                <button class="btn btn-warning" onclick="exportData()">💾 Export</button>
                <button class="btn btn-danger" onclick="deleteAll()">🗑️ Delete All</button>
            </div>
            <div class="groups-filter" id="groups-filter"></div>
            <div style="overflow-x: auto;">
                <table>
                    <thead><tr><th>Photo</th><th>Name</th><th>Passport</th><th>DOB</th><th>Place</th><th>Group</th><th>Actions</th></tr></thead>
                    <tbody id="tbody"><tr><td colspan="7"><div class="empty-state"><h3>Loading...</h3></div></td></tr></tbody>
                </table>
            </div>
        </div>
    </div>
    <div id="modal" class="modal">
        <div class="modal-content">
            <div class="modal-header"><h2 id="modal-title">Add Applicant</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
            <div class="modal-body">
                <div class="form-group"><label>Group</label><select id="fg"><option value="">No Group</option></select></div>
                <div class="form-group"><label>First Name *</label><input type="text" id="ff" data-next="fl"></div>
                <div class="form-group"><label>Last Name *</label><input type="text" id="fl" data-next="fp"></div>
                <div class="form-group"><label>Passport *</label><input type="text" id="fp" data-next="fd"></div>
                <div class="form-group"><label>Date of Birth</label><input type="date" id="fd" data-next="fb"></div>
                <div class="form-group">
                    <label>Place of Birth</label>
                    <select id="fb" data-next="fi">
                        <option value="">Select city...</option>
                        <option value="CASABLANCA">CASABLANCA</option>
                        <option value="NADOR">NADOR</option>
                        <option value="RABAT">RABAT</option>
                        <option value="TETOUAN">TETOUAN</option>
                        <option value="AGADIR">AGADIR</option>
                        <option value="TANGER">TANGER</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Issue Place</label>
                    <select id="fi" data-next="fph">
                        <option value="">Select city...</option>
                        <option value="CASABLANCA">CASABLANCA</option>
                        <option value="NADOR">NADOR</option>
                        <option value="RABAT">RABAT</option>
                        <option value="TETOUAN">TETOUAN</option>
                        <option value="AGADIR">AGADIR</option>
                        <option value="TANGER">TANGER</option>
                    </select>
                </div>
                <div class="form-group"><label>Photo (Max 200KB)</label><input type="file" id="fph" accept="image/*"><div id="prev"></div></div>
            </div>
            <div class="modal-footer"><button class="btn btn-danger" onclick="closeModal()">Cancel</button><button class="btn btn-success" onclick="saveApplicant()">Save</button></div>
        </div>
    </div>
    <div id="group-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header"><h2>Add New Group</h2><button class="close-btn" onclick="closeGroupModal()">&times;</button></div>
            <div class="modal-body">
                <div class="form-group"><label>Group Name *</label><input type="text" id="new-group-name" placeholder="e.g. Family, Friends"></div>
            </div>
            <div class="modal-footer"><button class="btn btn-danger" onclick="closeGroupModal()">Cancel</button><button class="btn btn-success" onclick="saveGroup()">Add Group</button></div>
        </div>
    </div>
    <script>
        const API = window.location.origin;
        let apps = [], groups = [], editIdx = -1, filter = 'all';

        async function loadData() {
            try {
                const r = await fetch(API + '/api/applicants');
                const d = await r.json();
                apps = d.applicants || [];
                groups = d.groups || [];
                updateUI(); // Batch all UI updates
            } catch (e) { toast('Load failed', 'error'); }
        }

        function render() {
            const tbody = document.getElementById('tbody');
            const search = document.getElementById('search').value.toLowerCase();
            let filtered = apps.filter(a => {
                const match = (a.FirstName||'').toLowerCase().includes(search) || (a.LastName||'').toLowerCase().includes(search) || (a.PassportNo||'').toLowerCase().includes(search);
                const grp = filter === 'all' || a.group === filter;
                return match && grp;
            });
            if (!filtered.length) {
                tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><h3>No applicants</h3></div></td></tr>';
                return;
            }
            
            // Use innerHTML for faster rendering - browser optimizes this
            tbody.innerHTML = filtered.map((a, i) => {
                const idx = apps.indexOf(a);
                const ph = a.photo ? \`<img src="\${a.photo}" class="photo-thumb">\` : '<div class="no-photo">👤</div>';
                return \`<tr><td>\${ph}</td><td><strong>\${a.FirstName||''} \${a.LastName||''}</strong></td><td>\${a.PassportNo||'N/A'}</td><td>\${a.DateOfBirth||'N/A'}</td><td>\${a.PlaceOfBirth||'N/A'}</td><td><span class="group-badge">\${a.group||'No Group'}</span></td><td><div class="actions"><button class="icon-btn" onclick="edit(\${idx})">✏️</button><button class="icon-btn" onclick="del(\${idx})">🗑️</button></div></td></tr>\`;
            }).join('');
        }

        function renderGroups() {
            const c = document.getElementById('groups-filter');
            const sel = document.getElementById('fg');
            const cnt = { all: apps.length };
            apps.forEach(a => { if (a.group) cnt[a.group] = (cnt[a.group]||0) + 1; });
            
            // Build groups filter HTML
            let h = \`<div class="group-badge \${filter==='all'?'active':''}" onclick="filterBy('all')">All (\${cnt.all})</div>\`;
            groups.forEach(g => h += \`<div class="group-badge \${filter===g?'active':''}" onclick="filterBy('\${g}')">\${g} (\${cnt[g]||0})</div>\`);
            c.innerHTML = h;
            
            // Build groups select HTML (preserve current selection)
            const currentSelection = sel.value;
            sel.innerHTML = '<option value="">No Group</option>';
            groups.forEach(g => sel.innerHTML += \`<option value="\${g}">\${g}</option>\`);
            sel.value = currentSelection; // Restore selection
        }

        function updateStats() {
            document.getElementById('total-applicants').textContent = apps.length;
            document.getElementById('total-groups').textContent = groups.length;
            document.getElementById('with-photos').textContent = apps.filter(a => a.photo).length;
        }

        // Batch all UI updates together for better performance
        function updateUI() {
            render();
            renderGroups();
            updateStats();
        }

        function filterBy(g) { filter = g; updateUI(); }
        function filterApplicants() { render(); }

        function showAddModal() {
            editIdx = -1;
            document.getElementById('modal-title').textContent = 'Add Applicant';
            
            // Clear all form fields
            document.getElementById('ff').value = '';
            document.getElementById('fl').value = '';
            document.getElementById('fp').value = '';
            document.getElementById('fd').value = '';
            document.getElementById('fb').value = '';
            document.getElementById('fi').value = '';
            
            // Auto-select group based on current filter (if not "all")
            if (filter !== 'all' && groups.includes(filter)) {
                document.getElementById('fg').value = filter;
            } else {
                document.getElementById('fg').value = '';
            }
            
            // IMPORTANT: Clear file input and preview
            document.getElementById('fph').value = '';
            document.getElementById('prev').innerHTML = '';
            
            document.getElementById('modal').classList.add('active');
            
            // Focus first field for quick entry
            setTimeout(() => document.getElementById('ff').focus(), 100);
        }

        function showAddGroupModal() {
            document.getElementById('new-group-name').value = '';
            document.getElementById('group-modal').classList.add('active');
        }

        function closeGroupModal() {
            document.getElementById('group-modal').classList.remove('active');
        }

        async function saveGroup() {
            const name = document.getElementById('new-group-name').value.trim();
            if (!name) { toast('Enter group name!', 'error'); return; }
            if (groups.includes(name)) { toast('Group already exists!', 'error'); return; }
            groups.push(name);
            await sync();
            closeGroupModal();
            toast('Group added!', 'success');
        }

        function edit(i) {
            editIdx = i;
            const a = apps[i];
            document.getElementById('modal-title').textContent = 'Edit Applicant';
            document.getElementById('ff').value = a.FirstName||'';
            document.getElementById('fl').value = a.LastName||'';
            document.getElementById('fp').value = a.PassportNo||'';
            document.getElementById('fd').value = a.DateOfBirth||'';
            document.getElementById('fb').value = a.PlaceOfBirth||'';
            document.getElementById('fi').value = a.IssuePlace||'';
            document.getElementById('fg').value = a.group||'';
            
            // IMPORTANT: Clear file input to prevent old photo from being applied
            document.getElementById('fph').value = '';
            
            // Show existing photo preview if exists
            document.getElementById('prev').innerHTML = a.photo ? \`<img src="\${a.photo}" style="max-width:150px;border-radius:8px;margin-top:10px">\` : '';
            
            document.getElementById('modal').classList.add('active');
        }

        function closeModal() { 
            // Clear file input when closing modal
            document.getElementById('fph').value = '';
            document.getElementById('prev').innerHTML = '';
            document.getElementById('modal').classList.remove('active'); 
        }

        document.getElementById('fph').addEventListener('change', e => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 200*1024) { toast('Photo too large! Max 200KB', 'error'); e.target.value = ''; return; }
            const r = new FileReader();
            r.onload = ev => document.getElementById('prev').innerHTML = \`<img src="\${ev.target.result}" style="max-width:150px;border-radius:8px;margin-top:10px">\`;
            r.readAsDataURL(f);
        });

        // Enter key navigation - move to next field
        document.querySelectorAll('#ff, #fl, #fp, #fd, #fb, #fi').forEach(input => {
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const nextId = input.getAttribute('data-next');
                    if (nextId) {
                        const nextField = document.getElementById(nextId);
                        if (nextField) nextField.focus();
                    }
                }
            });
        });

        // Auto-fill Issue Place when Place of Birth is selected
        document.getElementById('fb').addEventListener('change', e => {
            const placeOfBirth = e.target.value;
            const issuePlaceField = document.getElementById('fi');
            // Only auto-fill if Issue Place is empty or default
            if (!issuePlaceField.value || issuePlaceField.value === '') {
                issuePlaceField.value = placeOfBirth;
            }
        });

        async function saveApplicant() {
            const fn = document.getElementById('ff').value.trim();
            const ln = document.getElementById('fl').value.trim();
            const pp = document.getElementById('fp').value.trim();
            if (!fn || !ln || !pp) { toast('Fill required fields!', 'error'); return; }
            
            const pf = document.getElementById('fph').files[0];
            let ph = null;
            
            // Priority 1: If new photo file selected, use it
            if (pf) {
                console.log('Using new photo file');
                ph = await new Promise(res => {
                    const r = new FileReader();
                    r.onload = e => res(e.target.result);
                    r.readAsDataURL(pf);
                });
            } 
            // Priority 2: If editing and NO new photo, keep existing photo
            else if (editIdx >= 0 && apps[editIdx].photo) {
                console.log('Keeping existing photo');
                ph = apps[editIdx].photo;
            }
            // Priority 3: No photo (new applicant or editing without photo)
            else {
                console.log('No photo');
                ph = null;
            }

            const a = {
                group: document.getElementById('fg').value,
                FirstName: fn, LastName: ln, PassportNo: pp,
                DateOfBirth: document.getElementById('fd').value,
                PlaceOfBirth: document.getElementById('fb').value,
                IssuePlace: document.getElementById('fi').value,
                photo: ph
            };
            
            if (editIdx >= 0) {
                console.log('Updating applicant at index', editIdx);
                apps[editIdx] = a;
            } else {
                console.log('Adding new applicant');
                apps.push(a);
            }
            
            if (a.group && !groups.includes(a.group)) groups.push(a.group);
            await sync();
            closeModal();
            toast('Saved!', 'success');
        }

        async function del(i) {
            if (!confirm('Delete this applicant?')) return;
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
                updateUI(); // Batch all UI updates
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
        setInterval(loadData, 10000);
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

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Dashboard running on ${PORT}`);
});
