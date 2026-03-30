/* ═══════════════ APP.JS — Main controller & initialization ═══════════════ */

const App = (() => {
    let currentDb = null;

    // ── helpers ─────────────────────────────────────────────
    function formatBytes(b) {
        if (b === 0) return '0 B';
        const k = 1024, u = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return (b / Math.pow(k, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
    }

    function toast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        const id = 'toast-' + Date.now();
        const colorClass = { success: 'text-bg-success', danger: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-secondary' }[type] || 'text-bg-secondary';
        const el = document.createElement('div');
        el.id = id;
        el.className = `toast ${colorClass}`;
        el.setAttribute('role', 'alert');
        el.innerHTML = `<div class="toast-body d-flex justify-content-between align-items-center">${msg}<button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="toast"></button></div>`;
        container.appendChild(el);
        const t = new bootstrap.Toast(el, { delay: 4000 });
        t.show();
        el.addEventListener('hidden.bs.toast', () => el.remove());
    }

    async function api(url, opts = {}) {
        try {
            const r = await fetch(url, opts);
            if (!r.ok) {
                const err = await r.json().catch(() => ({ detail: r.statusText }));
                throw new Error(err.detail || r.statusText);
            }
            return r;
        } catch (e) {
            toast(e.message, 'danger');
            throw e;
        }
    }

    async function apiJson(url, opts = {}) {
        const r = await api(url, opts);
        return r.json();
    }

    // ── DB stats display ────────────────────────────────────
    function showStats(s) {
        const el = document.getElementById('db-stats');
        if (!s || !s.connected) {
            el.innerHTML = '<span class="text-muted">No database open</span>';
            return;
        }
        el.innerHTML = `<span title="Tables">${s.table_count} tables</span> · <span title="Total rows">${s.total_rows.toLocaleString()} rows</span> · <span title="File size">${formatBytes(s.file_size)}</span> · <span title="Journal mode">${s.journal_mode.toUpperCase()}</span>${s.wal_exists ? ' · <span class="text-warning" title="WAL file present">WAL</span>' : ''}`;
    }

    // ── DB selector ─────────────────────────────────────────
    async function refreshDbList() {
        const data = await apiJson('/api/databases');
        const sel = document.getElementById('db-selector');
        sel.innerHTML = '<option value="">— select database —</option>';
        for (const name of data.databases) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === currentDb) opt.selected = true;
            sel.appendChild(opt);
        }
    }

    async function openDb(name) {
        if (!name) return;
        showOverlay(true, 'Opening database…');
        try {
            const stats = await apiJson(`/api/databases/${encodeURIComponent(name)}/open`, { method: 'POST' });
            currentDb = name;
            showStats(stats);
            await AppState.save({ active_db: name });
            // Refresh child components
            if (typeof TableTree !== 'undefined') TableTree.load();
            if (typeof DataGrid !== 'undefined') DataGrid.clear();
            if (typeof WalBrowser !== 'undefined') WalBrowser.load();
            toast(`Opened ${name}`, 'success');
        } finally {
            showOverlay(false);
        }
    }

    // ── Upload ──────────────────────────────────────────────
    async function uploadFile(file) {
        showOverlay(true, `Uploading ${file.name}…`);
        try {
            const fd = new FormData();
            fd.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/databases/upload');

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round(e.loaded / e.total * 100);
                    const bar = document.getElementById('upload-progress-bar');
                    if (bar) {
                        bar.style.width = pct + '%';
                        bar.textContent = pct + '%';
                    }
                }
            };

            const result = await new Promise((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
                    else reject(new Error(xhr.responseText));
                };
                xhr.onerror = () => reject(new Error('Upload failed'));
                xhr.send(fd);
            });

            await refreshDbList();
            toast(`Uploaded ${result.name} (${formatBytes(result.size)})`, 'success');
            return result;
        } finally {
            showOverlay(false);
        }
    }

    // ── Delete ──────────────────────────────────────────────
    async function deleteDb() {
        const sel = document.getElementById('db-selector');
        const name = sel.value;
        if (!name) return toast('Select a database first', 'warning');

        document.getElementById('delete-db-name').textContent = name;
        new bootstrap.Modal(document.getElementById('deleteModal')).show();
    }

    async function confirmDelete() {
        const name = document.getElementById('delete-db-name').textContent;
        await apiJson(`/api/databases/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (currentDb === name) {
            currentDb = null;
            showStats(null);
            if (typeof TableTree !== 'undefined') TableTree.clear();
            if (typeof DataGrid !== 'undefined') DataGrid.clear();
        }
        bootstrap.Modal.getInstance(document.getElementById('deleteModal'))?.hide();
        await refreshDbList();
        toast(`Deleted ${name}`, 'success');
    }

    // ── Reset state ─────────────────────────────────────────
    function resetState() {
        new bootstrap.Modal(document.getElementById('resetModal')).show();
    }

    async function confirmReset() {
        await apiJson('/api/state', { method: 'DELETE' });
        Theme.reset();
        currentDb = null;
        showStats(null);
        if (typeof TableTree !== 'undefined') TableTree.clear();
        if (typeof DataGrid !== 'undefined') DataGrid.clear();
        bootstrap.Modal.getInstance(document.getElementById('resetModal'))?.hide();
        toast('State reset to defaults', 'success');
    }

    // ── Overlay ─────────────────────────────────────────────
    function showOverlay(show, text) {
        const el = document.getElementById('upload-overlay');
        if (show) {
            if (text) document.getElementById('upload-status').textContent = text;
            const bar = document.getElementById('upload-progress-bar');
            if (bar) { bar.style.width = '0%'; bar.textContent = ''; }
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    }

    // ── Sidebar resize ──────────────────────────────────────
    function initSidebarResize() {
        const handle = document.getElementById('sidebar-resize');
        const sidebar = document.getElementById('sidebar');
        if (!handle || !sidebar) return;

        let startX, startW;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            startX = e.clientX;
            startW = sidebar.offsetWidth;
            handle.classList.add('active');
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        function onMove(e) {
            const w = Math.max(160, Math.min(500, startW + e.clientX - startX));
            sidebar.style.width = w + 'px';
        }
        function onUp() {
            handle.classList.remove('active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            AppState.save({ sidebar_width: sidebar.offsetWidth });
        }
    }

    // ── Sidebar collapse ────────────────────────────────────
    function initSidebarCollapse() {
        const btn = document.getElementById('btn-collapse-sidebar');
        const sidebar = document.getElementById('sidebar');
        if (!btn || !sidebar) return;

        btn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            btn.innerHTML = sidebar.classList.contains('collapsed')
                ? '<i class="bi bi-layout-sidebar"></i>'
                : '<i class="bi bi-layout-sidebar-inset"></i>';
        });
    }

    // ── Init ────────────────────────────────────────────────
    async function init() {
        // Wire up header buttons
        document.getElementById('file-upload')?.addEventListener('change', async e => {
            if (e.target.files[0]) {
                await uploadFile(e.target.files[0]);
                e.target.value = '';
            }
        });
        document.getElementById('btn-open-db')?.addEventListener('click', () => {
            const name = document.getElementById('db-selector').value;
            if (name) openDb(name);
            else toast('Select a database first', 'warning');
        });
        document.getElementById('btn-delete-db')?.addEventListener('click', deleteDb);
        document.getElementById('btn-confirm-delete')?.addEventListener('click', confirmDelete);
        document.getElementById('btn-reset')?.addEventListener('click', resetState);
        document.getElementById('btn-confirm-reset')?.addEventListener('click', confirmReset);

        // Enable/disable Open and Delete buttons based on selector
        const dbSel = document.getElementById('db-selector');
        dbSel?.addEventListener('change', () => {
            const hasVal = !!dbSel.value;
            const openBtn = document.getElementById('btn-open-db');
            const delBtn = document.getElementById('btn-delete-db');
            if (openBtn) openBtn.disabled = !hasVal;
            if (delBtn) delBtn.disabled = !hasVal;
        });

        initSidebarResize();
        initSidebarCollapse();

        // Init sub-modules
        Theme.init();
        DataGrid.init();
        Search.init();
        ContextMenu.init();
        RowDetail.init();
        BlobViewer.init();
        WalBrowser.init();
        ExportManager.init();

        // Keyboard shortcuts
        document.addEventListener('keydown', handleShortcuts);

        // Load persisted state
        try {
            const state = await apiJson('/api/state');
            if (state.sidebar_width) {
                document.getElementById('sidebar').style.width = state.sidebar_width + 'px';
            }
            if (state.theme && state.theme !== 'system') {
                Theme.apply(state.theme);
            }
            // Refresh DB list
            await refreshDbList();
            if (state.active_db) {
                document.getElementById('db-selector').value = state.active_db;
                await openDb(state.active_db);
            }
        } catch {
            await refreshDbList();
        }
    }

    function handleShortcuts(e) {
        // Ctrl+F / Cmd+F → focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            const searchInput = document.getElementById('search-input');
            if (searchInput && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        }
        // Escape → close modals / clear search
        if (e.key === 'Escape') {
            const searchInput = document.getElementById('search-input');
            if (document.activeElement === searchInput && searchInput.value) {
                searchInput.value = '';
                Search.doSearch();
            }
        }
    }

    return { init, api, apiJson, toast, formatBytes, showOverlay, openDb, refreshDbList, get currentDb() { return currentDb; } };
})();

/* AppState helper — saves partial state to server */
const AppState = (() => {
    let pending = null;
    let timer = null;

    function save(partial) {
        pending = { ...(pending || {}), ...partial };
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const data = pending;
            pending = null;
            try {
                await fetch('/api/state', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });
            } catch { /* ignore */ }
        }, 500);
    }

    return { save };
})();

document.addEventListener('DOMContentLoaded', App.init);
