// ═══════════════════════════════════════════════════════════════
// WEB AUDIO
// ═══════════════════════════════════════════════════════════════
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type = 'sine', duration = 0.15, delay = 0) {
    try {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + duration);
    } catch (_) {}
}
const playSuccess = () => { playTone(523, 'triangle', .1); playTone(659, 'triangle', .15, .1); playTone(784, 'triangle', .25, .22); };
const playDenied = () => { playTone(300, 'sawtooth', .15); playTone(220, 'sawtooth', .25, .15); };

// ═══════════════════════════════════════════════════════════════
// SPA NAVIGATION STATE
// ═══════════════════════════════════════════════════════════════
let currentPage = 'landing';
let systemUnlocked = false;
let currentUserId = null;

function navigateTo(pageId) {
    document.querySelectorAll('.page-view').forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });

    const target = document.getElementById(`page-${pageId}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
    currentPage = pageId;

    const navStatus = document.getElementById('navRightStatus');
    if (pageId === 'landing') {
        navStatus.style.display = 'none';
    } else {
        navStatus.style.display = 'flex';
    }

    // Refresh users list immediately when switching to scanner
    if (pageId === 'scanner') {
        fetchUsers();
    }
}

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════
let toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast${type ? ' toast-' + type : ''}`;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function fetchJSON(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    return r.json();
}

// ═══════════════════════════════════════════════════════════════
// POLLING (Runs only when in scanner view)
// ═══════════════════════════════════════════════════════════════
async function pollStatus() {
    if (currentPage !== 'scanner') return;
    try {
        const data = await fetchJSON('/api/status');

        const frame        = document.getElementById('faceFrame');
        const frameStatus  = document.getElementById('frameStatus');
        const bannerIcon   = document.getElementById('bannerIcon');
        const bannerText   = document.getElementById('overlayMessage');
        const badge        = document.getElementById('systemStatusBadge');
        const dot          = document.getElementById('statusDot');
        const statusText   = document.getElementById('systemStatusText');
        const nav          = document.getElementById('navLockIcon');
        const scanLine     = document.getElementById('scanLine');

        if (data.unlocked && data.unlocked_user) {
            // ── UNLOCKED ──────────────────────────────────────────
            frame.className = 'face-frame unlocked';
            frameStatus.textContent = 'IDENTITY VERIFIED';
            bannerIcon.textContent = '🔓';
            bannerText.textContent = data.message;
            badge.classList.add('unlocked');
            dot.classList.add('green');
            statusText.textContent = 'UNLOCKED';
            nav.textContent = '🔓';
            scanLine.style.background = 'linear-gradient(90deg, transparent 0%, var(--green) 30%, #fff 50%, var(--green) 70%, transparent 100%)';
            scanLine.style.boxShadow = '0 0 18px var(--green), 0 0 6px #fff';

            if (!systemUnlocked || currentUserId !== data.unlocked_user.user_id) {
                playSuccess();
                systemUnlocked = true;
                currentUserId = data.unlocked_user.user_id;
                setupDashboard(data.unlocked_user);
                setTimeout(() => navigateTo('dashboard'), 1600);
            }

        } else if (data.liveness_passed || data.metrics?.ear < 0.25) {
            // ── FACE DETECTED / SCANNING ──────────────────────────
            frame.className = 'face-frame detected';
            frameStatus.textContent = data.liveness_passed ? 'LIVENESS VERIFIED' : 'FACE DETECTED';
            bannerIcon.textContent = '🔍';
            bannerText.textContent = data.message;
            badge.classList.remove('unlocked');
            dot.classList.remove('green');
            statusText.textContent = 'SCANNING';
            nav.textContent = '🔒';
            scanLine.style.background = 'linear-gradient(90deg, transparent 0%, var(--cyan) 30%, #fff 50%, var(--cyan) 70%, transparent 100%)';
            scanLine.style.boxShadow = '0 0 18px var(--cyan), 0 0 6px #fff';

            if (systemUnlocked) { systemUnlocked = false; currentUserId = null; }

        } else {
            // ── IDLE / NO FACE ────────────────────────────────────
            frame.className = 'face-frame';
            frameStatus.textContent = 'POSITION FACE IN FRAME';
            bannerIcon.textContent = '🔒';
            bannerText.textContent = data.message || 'Looking for face…';
            badge.classList.remove('unlocked');
            dot.classList.remove('green');
            statusText.textContent = 'LOCKED';
            nav.textContent = '🔒';
            scanLine.style.background = 'linear-gradient(90deg, transparent 0%, var(--cyan) 30%, #fff 50%, var(--cyan) 70%, transparent 100%)';
            scanLine.style.boxShadow = '0 0 18px var(--cyan), 0 0 6px #fff';

            if (systemUnlocked) { systemUnlocked = false; currentUserId = null; }
        }

        // ── Telemetry ──────────────────────────────────────────────
        document.getElementById('matchScore').textContent  = data.similarity.toFixed(3);
        if (data.metrics) {
            document.getElementById('earMetric').textContent   = data.metrics.ear.toFixed(3);
            document.getElementById('smileMetric').textContent = data.metrics.smile.toFixed(3);
            document.getElementById('poseMetric').textContent  = `${data.metrics.yaw.toFixed(1)}° / ${data.metrics.pitch.toFixed(1)}°`;
        }
        document.getElementById('currentChallenge').textContent = data.challenge;
        document.getElementById('livenessStatus').textContent   = data.liveness_passed ? 'VERIFIED ✓' : 'Awaiting gesture…';
        document.getElementById('livenessProgress').style.width = data.liveness_passed ? '100%' : '40%';
        document.getElementById('userCountBadge').textContent   = `${data.registered_users_count} Users`;

    } catch (_) {}
}


async function lockSystemAndExit() {
    await fetchJSON('/api/lock', 'POST');
    systemUnlocked = false;
    currentUserId = null;
    navigateTo('landing');
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD & PERSONAL SHORTCUTS
// ═══════════════════════════════════════════════════════════════
function setupDashboard(user) {
    document.getElementById('dashWelcomeText').textContent = `Welcome back, ${user.name}`;
    document.getElementById('dashRoleText').textContent = user.role;
    
    // Update avatar if we have a face image
    const dashAvatar = document.getElementById('dashAvatar');
    if (user.face_image) {
        dashAvatar.innerHTML = `<img src="/api/faces/${user.face_image}" alt="User Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        dashAvatar.innerHTML = '👤';
    }

    loadPersonalShortcuts(user.user_id);
    loadUserVaultFiles(user.user_id);
}

async function loadUserVaultFiles(userId) {
    const grid = document.getElementById('userVaultGrid');
    if (!grid) return;
    const res = await fetchJSON(`/api/files/${userId}`);
    if (!res || !res.files) return;

    const files = res.files;
    const storage = res.storage;

    // Update storage bar
    document.getElementById('storageUsedText').textContent = `${storage.used_mb} MB`;
    document.getElementById('storagePercentText').textContent = `${storage.percent}%`;
    document.getElementById('storageProgressBar').style.width = `${storage.percent}%`;

    if (files.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No PDF files or documents stored yet. Click Upload PDF / Document.</div>';
        return;
    }

    grid.innerHTML = files.map(f => `
        <div class="shortcut-tile" style="align-items:flex-start;padding:1rem;position:relative;">
            <div class="shortcut-actions" style="display:flex;">
                <button class="sc-btn del" onclick="deleteVaultFile('${f.id}')">✕</button>
            </div>
            <div style="font-size:2rem;margin-bottom:.3rem;">📄</div>
            <strong style="font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--text);">${f.name}</strong>
            <span style="font-size:.75rem;color:var(--muted);">${f.size_mb} MB · ${f.uploaded_at.split(' ')[0]}</span>
            <a href="/api/files/${userId}/download/${f.id}" class="btn btn-outline btn-sm" style="margin-top:.6rem;width:100%;text-align:center;text-decoration:none;">📥 Download / View</a>
        </div>
    `).join('');
}

async function handleVaultUpload(input) {
    if (!currentUserId || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    showToast('Uploading file to vault...');
    try {
        const response = await fetch(`/api/files/${currentUserId}/upload`, {
            method: 'POST',
            body: formData
        });
        const res = await response.json();
        if (res.status === 'success') {
            showToast('Document stored in vault!');
            loadUserVaultFiles(currentUserId);
        } else {
            showToast(res.message || 'Upload failed', 'error');
        }
    } catch (e) {
        showToast('Upload error', 'error');
    }
    input.value = '';
}

async function deleteVaultFile(fileId) {
    if (!currentUserId) return;
    if (!confirm('Delete this file from your vault?')) return;
    await fetchJSON(`/api/files/${currentUserId}/${fileId}`, 'DELETE');
    loadUserVaultFiles(currentUserId);
}

async function loadPersonalShortcuts(userId) {
    const grid = document.getElementById('personalShortcutsGrid');
    const items = await fetchJSON(`/api/shortcuts/${userId}`);
    grid.innerHTML = '';
    
    if (!items || items.length === 0) {
        grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;">No personal files or links yet. Click Add New.</p>';
        return;
    }

    items.forEach(sc => {
        const tile = document.createElement('a');
        tile.className = 'shortcut-tile';
        tile.href = sc.url;
        tile.target = '_blank';
        tile.rel = 'noopener';
        tile.style.borderColor = sc.color + '55';
        
        let iconHtml = `<span class="shortcut-icon">${sc.icon}</span>`;
        if (sc.type === 'image') iconHtml = `<img src="${sc.url}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">`;
        if (sc.type === 'pdf')   iconHtml = `<span class="shortcut-icon">📄</span>`;

        tile.innerHTML = `
            <div class="shortcut-actions" onclick="event.preventDefault(); event.stopPropagation();">
                <button class="sc-btn del" onclick="deleteShortcut('${sc.id}')">✕</button>
            </div>
            ${iconHtml}
            <span class="shortcut-name">${sc.name}</span>
        `;
        grid.appendChild(tile);
    });
}

function openAddShortcutModal() {
    document.getElementById('scName').value = '';
    document.getElementById('scUrl').value = '';
    document.getElementById('addShortcutModal').classList.remove('hidden');
}
function closeAddShortcutModal() { document.getElementById('addShortcutModal').classList.add('hidden'); }

async function saveShortcut() {
    if (!currentUserId) return;
    const name = document.getElementById('scName').value.trim();
    const url = document.getElementById('scUrl').value.trim();
    const stype = document.getElementById('scType').value;
    const color = document.getElementById('scColor').value || '#4facfe';
    
    let icon = '🔗';
    if (stype === 'pdf') icon = '📄';
    if (stype === 'image') icon = '🖼️';

    if (!name || !url) { showToast('Name and URL required'); return; }

    const res = await fetchJSON(`/api/shortcuts/${currentUserId}`, 'POST', { name, url, type: stype, icon, color });
    if (res.status === 'success') {
        showToast('Added to your dashboard');
        closeAddShortcutModal();
        loadPersonalShortcuts(currentUserId);
    } else {
        showToast(res.message, 'error');
    }
}

async function deleteShortcut(shortcutId) {
    if (!currentUserId) return;
    if (!confirm('Remove this item?')) return;
    await fetchJSON(`/api/shortcuts/${currentUserId}/${shortcutId}`, 'DELETE');
    loadPersonalShortcuts(currentUserId);
}


// ═══════════════════════════════════════════════════════════════
// USERS MGMT & DATABASE (Protected View)
// ═══════════════════════════════════════════════════════════════
async function fetchUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;
    const users = await fetchJSON('/api/users');
    if (!users.length) {
        list.innerHTML = '<div class="empty-state">No identities registered in database yet.</div>';
        return;
    }
    list.innerHTML = users.map(u => {
        let avatarHtml = `<div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">👤</div>`;
        if (u.face_image) {
            avatarHtml = `<img src="/api/faces/${u.face_image}" alt="Face" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
        }
        const scCount = u.shortcuts_count || 0;
        return `
        <div class="user-item">
            <div style="display:flex;gap:1rem;align-items:center;">
                ${avatarHtml}
                <div class="user-info">
                    <strong>${u.name}</strong>
                    <div class="user-meta">${u.role} · Registered ${u.registered_at.split(' ')[0]} · ${scCount} Saved Links</div>
                </div>
            </div>
            <div class="user-actions">
                <button class="btn-icon edit" onclick="openEditUserModal('${u.user_id}','${u.name}','${u.role}')">✏️</button>
                <button class="btn-icon" onclick="deleteUser('${u.user_id}','${u.name}')">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

async function deleteUser(id, name) {
    if (!confirm(`Remove user "${name}"?`)) return;
    await fetchJSON(`/api/users/${id}`, 'DELETE');
    fetchUsers();
}

// ── REGISTRATION MODAL
function openRegisterModal() {
    document.getElementById('registerModal').classList.remove('hidden');
    document.getElementById('regStatus').style.display = 'none';
    document.getElementById('btnRegStart').classList.remove('hidden');
    document.getElementById('btnRegCapture').classList.add('hidden');
    document.getElementById('btnRegCancel').classList.add('hidden');
}
function closeRegisterModal() {
    document.getElementById('registerModal').classList.add('hidden');
    fetchJSON('/api/register/cancel', 'POST').catch(() => {});
}

async function startRegistration() {
    const name = document.getElementById('regName').value.trim();
    const role = document.getElementById('regRole').value;
    if (!name) return alert('Enter a name');
    document.getElementById('regStatus').textContent = 'Position your face in camera view and capture.';
    document.getElementById('regStatus').className = 'reg-status info';
    await fetchJSON('/api/register/start', 'POST', { name, role });
    document.getElementById('btnRegStart').classList.add('hidden');
    document.getElementById('btnRegCapture').classList.remove('hidden');
    document.getElementById('btnRegCancel').classList.remove('hidden');
}

async function captureRegistration() {
    const res = await fetchJSON('/api/register/capture', 'POST');
    if (res.status === 'success') {
        document.getElementById('regStatus').textContent = '✅ Registered successfully!';
        document.getElementById('regStatus').className = 'reg-status success';
        playSuccess();
        setTimeout(() => { closeRegisterModal(); fetchUsers(); }, 1500);
    } else {
        document.getElementById('regStatus').textContent = `❌ ${res.message}`;
        document.getElementById('regStatus').className = 'reg-status error';
    }
}
async function cancelRegistration() {
    await fetchJSON('/api/register/cancel', 'POST');
    closeRegisterModal();
}

// ── EDIT MODAL
function openEditUserModal(id, name, role) {
    document.getElementById('editUserId').value = id;
    document.getElementById('editUserName').value = name;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserModal').classList.remove('hidden');
}
function closeEditUserModal() { document.getElementById('editUserModal').classList.add('hidden'); }
async function saveUserEdit() {
    const id = document.getElementById('editUserId').value;
    const name = document.getElementById('editUserName').value.trim();
    const role = document.getElementById('editUserRole').value;
    await fetchJSON(`/api/users/${id}`, 'PUT', { name, role });
    closeEditUserModal();
    fetchUsers();
}

async function setLivenessMode(mode) {
    await fetchJSON('/api/set_liveness', 'POST', { mode });
    document.getElementById('btnModeNormal').classList.toggle('active', mode === 'BLINK');
    document.getElementById('btnModeStrict').classList.toggle('active', mode === 'STRICT');
}

// Close modals on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => { if (e.target === bd) bd.classList.add('hidden'); });
});

// Timers
setInterval(pollStatus, 400);
setInterval(fetchUsers, 4000);
fetchUsers();

// Initialize landing
navigateTo('landing');
