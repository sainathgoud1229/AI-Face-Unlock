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

    // Refresh users list & start camera fallback when switching to scanner
    if (pageId === 'scanner') {
        fetchUsers();
        startWebcamFallback();
    }
    // Stop webcam stream when leaving scanner
    if (pageId !== 'scanner') {
        stopWebcam();
    }
}

// ═══════════════════════════════════════════════════════════════
// BROWSER WEBCAM STREAMING (RENDER & VERCEL CLOUD COMPATIBILITY)
// ═══════════════════════════════════════════════════════════════
let webcamStream = null;
let frameProcessingInterval = null;
let deniedPopupShown = false;

function stopWebcam() {
    if (frameProcessingInterval) {
        clearInterval(frameProcessingInterval);
        frameProcessingInterval = null;
    }
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }
    deniedPopupShown = false;
    const videoElem = document.getElementById('webcamVideo');
    const imgFeed   = document.getElementById('videoFeed');
    if (videoElem) videoElem.style.display = 'none';
    if (imgFeed)   imgFeed.style.display   = 'block';
}

async function startWebcamFallback() {
    const imgFeed = document.getElementById('videoFeed');
    const videoElem = document.getElementById('webcamVideo');
    const canvasElem = document.getElementById('webcamCanvas');

    if (!videoElem) return;

    try {
        if (!webcamStream) {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
            });
            videoElem.srcObject = webcamStream;
            videoElem.style.display = 'block';
            if (imgFeed) imgFeed.style.display = 'none';
        }

        if (!frameProcessingInterval) {
            frameProcessingInterval = setInterval(async () => {
                if (currentPage !== 'scanner' || !videoElem.videoWidth) return;
                
                const ctx = canvasElem.getContext('2d');
                canvasElem.width = videoElem.videoWidth;
                canvasElem.height = videoElem.videoHeight;
                ctx.drawImage(videoElem, 0, 0, canvasElem.width, canvasElem.height);
                
                const b64Image = canvasElem.toDataURL('image/jpeg', 0.6);
                
                try {
                    const res = await fetch('/api/process_frame', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image: b64Image })
                    });
                    const json = await res.json();
                    if (json.status === 'success' && json.state) {
                        updateScannerUI(json.state);
                    }
                } catch (_) {}
            }, 180);
        }
    } catch (err) {
        console.warn('Browser camera unavailable:', err);
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
    try {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const r = await fetch(url, opts);
        return await r.json();
    } catch (e) {
        console.error('[fetchJSON] Error:', url, e);
        return { status: 'error', message: 'Network error. Please try again.' };
    }
}

// ═══════════════════════════════════════════════════════════════
// POLLING (Runs only when in scanner view)
// ═══════════════════════════════════════════════════════════════
async function pollStatus() {
    if (currentPage !== 'scanner') return;
    try {
        const data = await fetchJSON('/api/status');
        updateScannerUI(data);
    } catch (_) {}
}

function updateScannerUI(data) {
    if (!data) return;

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
        deniedPopupShown = false;

        if (!systemUnlocked || currentUserId !== data.unlocked_user.user_id) {
            playSuccess();
            systemUnlocked = true;
            currentUserId = data.unlocked_user.user_id;
            setupDashboard(data.unlocked_user);
            setTimeout(() => {
                navigateTo('dashboard');
            }, 1600);
        }

    } else if (data.access_denied && !systemUnlocked) {
        // ── FACE SEEN BUT NOT REGISTERED ─────────────────────
        frame.className = 'face-frame';
        frameStatus.textContent = 'IDENTITY NOT RECOGNIZED';
        bannerIcon.textContent = '❌';
        bannerText.textContent = 'Face not found in database.';
        badge.classList.remove('unlocked');
        dot.classList.remove('green');
        statusText.textContent = 'DENIED';
        nav.textContent = '🔒';
        scanLine.style.background = 'linear-gradient(90deg, transparent 0%, #ff4444 30%, #fff 50%, #ff4444 70%, transparent 100%)';
        scanLine.style.boxShadow = '0 0 18px #ff4444, 0 0 6px #fff';

        if (!deniedPopupShown) {
            deniedPopupShown = true;
            playDenied();
            showNotFoundPopup();
            // Reset access_denied after 4 seconds so scan can retry
            setTimeout(async () => {
                deniedPopupShown = false;
                await fetch('/api/lock', { method: 'POST' });
            }, 4000);
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
    if (data.similarity !== undefined) {
        document.getElementById('matchScore').textContent = data.similarity.toFixed(3);
    }
    if (data.metrics) {
        document.getElementById('earMetric').textContent   = data.metrics.ear.toFixed(3);
        document.getElementById('smileMetric').textContent = data.metrics.smile.toFixed(3);
        document.getElementById('poseMetric').textContent  = `${data.metrics.yaw.toFixed(1)}° / ${data.metrics.pitch.toFixed(1)}°`;
    }
    if (data.challenge) {
        document.getElementById('currentChallenge').textContent = data.challenge;
    }
    document.getElementById('livenessStatus').textContent   = data.liveness_passed ? 'VERIFIED ✓' : 'Awaiting gesture…';
    document.getElementById('livenessProgress').style.width = data.liveness_passed ? '100%' : '40%';
    if (data.registered_users_count !== undefined) {
        document.getElementById('userCountBadge').textContent = `${data.registered_users_count} Users`;
    }
}


async function lockSystemAndExit() {
    await fetchJSON('/api/lock', 'POST');
    systemUnlocked = false;
    currentUserId = null;
    navigateTo('landing');
}

// ═══════════════════════════════════════════════════════════════
// NOT FOUND POPUP
// ═══════════════════════════════════════════════════════════════
function showNotFoundPopup() {
    // Remove any existing popup
    const existing = document.getElementById('notFoundPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'notFoundPopup';
    popup.style.cssText = `
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%) scale(0.85);
        background: linear-gradient(135deg, #1a0a0a 0%, #2d0f0f 100%);
        border: 1.5px solid #ff4444;
        border-radius: 20px;
        padding: 2.5rem 2rem;
        z-index: 9999;
        text-align: center;
        min-width: 320px;
        box-shadow: 0 0 40px rgba(255,68,68,0.4), 0 0 80px rgba(255,68,68,0.15);
        animation: popupIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards;
        font-family: inherit;
        color: #fff;
    `;
    popup.innerHTML = `
        <div style="font-size:3rem;margin-bottom:0.75rem;">🚫</div>
        <h3 style="margin:0 0 0.5rem;font-size:1.3rem;color:#ff6666;letter-spacing:1px;">FACE NOT RECOGNIZED</h3>
        <p style="margin:0 0 1.2rem;font-size:0.95rem;color:#ccc;line-height:1.5;">
            Your face was not found in the identity database.<br>
            <strong style="color:#fff;">Please register first</strong> using the <em>+ Register Face</em> button.
        </p>
        <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
            <button onclick="document.getElementById('notFoundPopup').remove(); openRegisterModal();"
                style="background:linear-gradient(135deg,#ff4444,#cc0000);border:none;color:#fff;padding:0.6rem 1.4rem;border-radius:10px;cursor:pointer;font-size:0.9rem;font-weight:600;">
                + Register Now
            </button>
            <button onclick="document.getElementById('notFoundPopup').remove();"
                style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ccc;padding:0.6rem 1.4rem;border-radius:10px;cursor:pointer;font-size:0.9rem;">
                Try Again
            </button>
        </div>
    `;

    // Inject animation keyframe once
    if (!document.getElementById('popupKeyframes')) {
        const style = document.createElement('style');
        style.id = 'popupKeyframes';
        style.textContent = `@keyframes popupIn { from { transform:translate(-50%,-50%) scale(0.7); opacity:0; } to { transform:translate(-50%,-50%) scale(1); opacity:1; } }`;
        document.head.appendChild(style);
    }

    document.body.appendChild(popup);

    // Auto-dismiss after 5 seconds
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 5000);
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
    if (!currentUserId) {
        showToast('Session expired. Please scan your face again.', 'error');
        return;
    }
    const name = document.getElementById('scName').value.trim();
    const url = document.getElementById('scUrl').value.trim();
    const stype = document.getElementById('scType').value;
    const color = document.getElementById('scColor').value || '#4facfe';
    
    let icon = '🔗';
    if (stype === 'pdf') icon = '📄';
    if (stype === 'image') icon = '🖼️';

    if (!name || !url) { showToast('Name and URL required'); return; }

    showToast('Saving...');
    try {
        const res = await fetchJSON(`/api/shortcuts/${currentUserId}`, 'POST', { name, url, type: stype, icon, color });
        if (res.status === 'success') {
            showToast('Added to your dashboard! ✅');
            closeAddShortcutModal();
            loadPersonalShortcuts(currentUserId);
        } else {
            showToast(res.message || 'Save failed', 'error');
        }
    } catch (e) {
        console.error('Save shortcut error:', e);
        showToast('Failed to save. Please try again.', 'error');
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
}

async function startRegistration() {
    const name = document.getElementById('regName').value.trim();
    if (!name) return alert('Enter a name');
    document.getElementById('regStatus').textContent = 'Position your face in camera view and capture.';
    document.getElementById('regStatus').className = 'reg-status info';
    document.getElementById('btnRegStart').classList.add('hidden');
    document.getElementById('btnRegCapture').classList.remove('hidden');
    document.getElementById('btnRegCancel').classList.remove('hidden');
}

async function captureRegistration() {
    const name = document.getElementById('regName').value.trim();
    const role = document.getElementById('regRole').value;
    
    // Capture the frame directly from the video element
    const videoElem = document.getElementById('webcamVideo');
    if (!videoElem || videoElem.videoWidth === 0) {
        document.getElementById('regStatus').textContent = '❌ Camera not ready or not found.';
        document.getElementById('regStatus').className = 'reg-status error';
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoElem.videoWidth;
    canvas.height = videoElem.videoHeight;
    canvas.getContext('2d').drawImage(videoElem, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);

    document.getElementById('regStatus').textContent = '⏳ Processing biometric registration...';
    document.getElementById('regStatus').className = 'reg-status info';

    const res = await fetchJSON('/api/register/capture', 'POST', { name, role, image: imageBase64 });
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
