/* WAL Browser — WAL tab with frames, records, summary, transactions */
var WalBrowser = (function () {
    'use strict';

    let walStatus = null;
    let currentView = 'frames';  // frames | records | summary | transactions
    let framesData = [];
    let recordsData = [];

    function init() {
        const tab = document.getElementById('tab-wal');
        if (!tab) return;
        tab.addEventListener('shown.bs.tab', () => load());

        const container = document.getElementById('wal-content');
        if (!container) return;

        container.innerHTML = `
        <div class="wal-toolbar d-flex align-items-center gap-2 p-2 border-bottom">
            <button class="btn btn-sm btn-outline-secondary" id="wal-reload-btn" title="Reload WAL">
                <i class="bi bi-arrow-clockwise"></i>
            </button>
            <div class="btn-group btn-group-sm" role="group">
                <button class="btn btn-outline-primary active" data-wal-view="frames">Frames</button>
                <button class="btn btn-outline-primary" data-wal-view="records">Records</button>
                <button class="btn btn-outline-primary" data-wal-view="summary">Summary</button>
                <button class="btn btn-outline-primary" data-wal-view="transactions">Transactions</button>
            </div>
            <div class="wal-filters d-flex align-items-center gap-2 ms-2" id="wal-filters">
                <select class="form-select form-select-sm" id="wal-filter-status" style="width:auto">
                    <option value="">All Status</option>
                    <option value="saved">Saved</option>
                    <option value="unsaved">Unsaved</option>
                    <option value="overwritten">Overwritten</option>
                </select>
                <select class="form-select form-select-sm" id="wal-filter-diff" style="width:auto;display:none">
                    <option value="all">All Records</option>
                    <option value="different">≠ Different</option>
                    <option value="wal_only">∅ Not in DB</option>
                    <option value="wal_tables">★ WAL-only Tables</option>
                    <option value="same">✓ Same</option>
                </select>
            </div>
            <div class="ms-auto d-flex gap-1">
                <button class="btn btn-sm btn-outline-secondary" id="wal-export-btn" title="Export CSV">
                    <i class="bi bi-download"></i> Export
                </button>
                <button class="btn btn-sm btn-outline-secondary" id="wal-header-btn" title="WAL Header Info">
                    <i class="bi bi-info-circle"></i> Header
                </button>
            </div>
        </div>
        <div class="wal-data-content flex-grow-1 overflow-auto" id="wal-data"></div>
        `;

        // View toggle buttons
        container.querySelectorAll('[data-wal-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('[data-wal-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                switchView(btn.dataset.walView);
            });
        });

        // Status filter
        document.getElementById('wal-filter-status').addEventListener('change', () => {
            if (currentView === 'frames') loadFrames();
        });
        document.getElementById('wal-filter-diff').addEventListener('change', () => {
            if (currentView === 'records') loadRecords();
        });

        document.getElementById('wal-reload-btn').addEventListener('click', reloadWal);
        document.getElementById('wal-export-btn').addEventListener('click', exportCsv);
        document.getElementById('wal-header-btn').addEventListener('click', showHeader);
    }

    async function load() {
        try {
            walStatus = await App.apiJson('/api/wal/status');
            if (!walStatus.exists) {
                document.getElementById('wal-data').innerHTML =
                    '<div class="text-center text-muted py-5">No WAL file found for the active database.</div>';
                return;
            }
            switchView(currentView);
        } catch (e) {
            document.getElementById('wal-data').innerHTML =
                '<div class="text-center text-muted py-5">Open a database to browse its WAL file.</div>';
        }
    }

    function switchView(view) {
        currentView = view;
        const statusSel = document.getElementById('wal-filter-status');
        const diffSel = document.getElementById('wal-filter-diff');
        statusSel.style.display = (view === 'frames') ? '' : 'none';
        diffSel.style.display = (view === 'records') ? '' : 'none';

        if (view === 'frames') loadFrames();
        else if (view === 'records') loadRecords();
        else if (view === 'summary') loadSummary();
        else if (view === 'transactions') loadTransactions();
    }

    /* ── Frames View ─────────────────────────────────────────────── */
    async function loadFrames() {
        const content = document.getElementById('wal-data');
        content.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

        const status = document.getElementById('wal-filter-status').value;
        let url = '/api/wal/frames';
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (params.toString()) url += '?' + params;

        try {
            const data = await App.apiJson(url);
            framesData = data.frames;
            renderFrames(framesData);
        } catch (e) {
            content.innerHTML = `<div class="text-danger p-3">${esc(e.message)}</div>`;
        }
    }

    function renderFrames(frames) {
        const content = document.getElementById('wal-data');
        if (!frames.length) {
            content.innerHTML = '<div class="text-center text-muted py-4">No frames match the filter.</div>';
            return;
        }

        let html = `<div class="table-responsive"><table class="table table-sm table-hover mb-0">
        <thead><tr>
            <th>#</th><th>Page</th><th>Type</th><th>Cells</th>
            <th>Commit</th><th>Status</th><th>Table</th><th>Salt</th>
        </tr></thead><tbody>`;

        for (const f of frames) {
            html += `<tr class="wal-frame-row" data-index="${f.index}">
                <td>${f.index}</td>
                <td>${f.page_number}</td>
                <td>${esc(f.page_type_name)}</td>
                <td>${f.cell_count}</td>
                <td>${f.is_commit ? '<span class="badge bg-success">Yes (' + f.commit_size + ')</span>' : ''}</td>
                <td><span class="wal-status-badge wal-status-${f.status}">${f.status}</span></td>
                <td>${esc(f.table_name || '')}</td>
                <td class="text-muted small">${f.salt1}:${f.salt2}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        content.innerHTML = html;

        content.querySelectorAll('.wal-frame-row').forEach(row => {
            row.addEventListener('click', () => showFrameDetail(parseInt(row.dataset.index)));
        });
    }

    async function showFrameDetail(index) {
        try {
            const frame = await App.apiJson(`/api/wal/frames/${index}`);
            const modal = document.getElementById('walDetailModal') || createDetailModal();

            let html = `<h6>Frame #${frame.index} — Page ${frame.page_number}</h6>
            <div class="row mb-3">
                <div class="col-6">
                    <table class="table table-sm">
                        <tr><td>Page Type</td><td>${esc(frame.page_type_name)}</td></tr>
                        <tr><td>Cell Count</td><td>${frame.cell_count}</td></tr>
                        <tr><td>Status</td><td><span class="wal-status-badge wal-status-${frame.status}">${frame.status}</span></td></tr>
                        <tr><td>Commit Size</td><td>${frame.commit_size}</td></tr>
                    </table>
                </div>
                <div class="col-6">
                    <table class="table table-sm">
                        <tr><td>Table</td><td>${esc(frame.table_name || 'Unknown')}</td></tr>
                        <tr><td>Right Child</td><td>${frame.right_child || 'N/A'}</td></tr>
                        <tr><td>Salt</td><td>${frame.salt1} : ${frame.salt2}</td></tr>
                        <tr><td>Offset</td><td>0x${frame.offset.toString(16)}</td></tr>
                    </table>
                </div>
            </div>`;

            if (frame.cells && frame.cells.length) {
                html += '<h6>Cells</h6><div class="table-responsive" style="max-height:300px;overflow:auto"><table class="table table-sm"><thead><tr><th>#</th><th>Type</th><th>RowID</th><th>Values</th></tr></thead><tbody>';
                frame.cells.forEach((cell, i) => {
                    const valsStr = (cell.values || []).map(v => {
                        if (v && typeof v === 'object' && v.__blob__) return `[BLOB ${v.size}B]`;
                        if (v === null) return '<span class="text-muted">NULL</span>';
                        const s = String(v);
                        return s.length > 80 ? esc(s.substring(0, 80)) + '…' : esc(s);
                    }).join(' | ');
                    html += `<tr><td>${i}</td><td>${esc(cell.type || '')}</td><td>${cell.rowid ?? ''}</td><td class="small">${valsStr}</td></tr>`;
                });
                html += '</tbody></table></div>';
            }

            modal.querySelector('.modal-body').innerHTML = html;
            const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
            bsModal.show();
        } catch (e) {
            App.toast('Error loading frame detail', 'danger');
        }
    }

    /* ── Records View ────────────────────────────────────────────── */
    async function loadRecords() {
        const content = document.getElementById('wal-data');
        content.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

        const filterType = document.getElementById('wal-filter-diff').value;
        try {
            const data = await App.apiJson(`/api/wal/records?filter_type=${filterType}`);
            recordsData = data.records;
            renderRecords(recordsData);
        } catch (e) {
            content.innerHTML = `<div class="text-danger p-3">${esc(e.message)}</div>`;
        }
    }

    function renderRecords(records) {
        const content = document.getElementById('wal-data');
        if (!records.length) {
            content.innerHTML = '<div class="text-center text-muted py-4">No records match the filter.</div>';
            return;
        }

        let html = `<div class="table-responsive"><table class="table table-sm table-hover mb-0">
        <thead><tr>
            <th>Diff</th><th>Frame</th><th>Table</th><th>RowID</th>
            <th>Status</th><th>Size</th><th>Values</th>
        </tr></thead><tbody>`;

        for (const r of records) {
            const diffClass = {'✓': 'text-success', '≠': 'text-warning', '∅': 'text-info', '★': 'text-danger'}[r.diff] || '';
            const valsStr = (r.values || []).map(v => {
                if (v && typeof v === 'object' && v.__blob__) return `[BLOB]`;
                if (v === null) return 'NULL';
                const s = String(v);
                return s.length > 40 ? s.substring(0, 40) + '…' : s;
            }).join(' | ');

            html += `<tr>
                <td><span class="${diffClass}" title="${diffTitle(r.diff)}">${r.diff}</span></td>
                <td>${r.frame_index}</td>
                <td>${esc(r.table_name)}</td>
                <td>${r.rowid ?? ''}</td>
                <td><span class="wal-status-badge wal-status-${r.status}">${r.status}</span></td>
                <td>${r.payload_size}${r.has_overflow ? ' ⚡' : ''}</td>
                <td class="small">${esc(valsStr)}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        content.innerHTML = html;
    }

    function diffTitle(d) {
        return {'✓': 'Same as DB', '≠': 'Different from DB', '∅': 'Not in DB', '★': 'WAL-only table'}[d] || '';
    }

    /* ── Summary View ────────────────────────────────────────────── */
    async function loadSummary() {
        const content = document.getElementById('wal-data');
        content.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

        try {
            const data = await App.apiJson('/api/wal/summary');
            let html = `<div class="p-3">
                <div class="mb-3"><strong>Total Frames:</strong> ${data.total_frames}</div>
                <div class="table-responsive"><table class="table table-sm">
                <thead><tr><th>Table</th><th>Frames</th><th>Records</th><th>Saved</th><th>Unsaved</th><th>Overwritten</th><th>Page Types</th></tr></thead><tbody>`;

            for (const t of data.tables) {
                html += `<tr>
                    <td>${esc(t.name)}</td>
                    <td>${t.frame_count}</td>
                    <td>${t.record_count}</td>
                    <td>${t.saved}</td>
                    <td>${t.unsaved}</td>
                    <td>${t.overwritten}</td>
                    <td class="small">${t.page_types.map(esc).join(', ')}</td>
                </tr>`;
            }

            html += '</tbody></table></div></div>';
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = `<div class="text-danger p-3">${esc(e.message)}</div>`;
        }
    }

    /* ── Transactions View ───────────────────────────────────────── */
    async function loadTransactions() {
        const content = document.getElementById('wal-data');
        content.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

        try {
            const data = await App.apiJson('/api/wal/transactions');
            let html = `<div class="table-responsive"><table class="table table-sm">
            <thead><tr><th>TX #</th><th>Frames</th><th>Range</th><th>Salt</th></tr></thead><tbody>`;

            for (const tx of data.transactions) {
                const range = tx.frame_range.length === 2 ? `${tx.frame_range[0]}–${tx.frame_range[1]}` : '';
                html += `<tr>
                    <td>${tx.index}</td>
                    <td>${tx.frame_count}</td>
                    <td>${range}</td>
                    <td class="text-muted small">${tx.salt1}:${tx.salt2}</td>
                </tr>`;
            }

            html += '</tbody></table></div>';
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = `<div class="text-danger p-3">${esc(e.message)}</div>`;
        }
    }

    /* ── Header Modal ────────────────────────────────────────────── */
    async function showHeader() {
        try {
            const h = await App.apiJson('/api/wal/header');
            const modal = document.getElementById('walDetailModal') || createDetailModal();
            let html = '<h6>WAL Header</h6><table class="table table-sm">';
            for (const [k, v] of Object.entries(h)) {
                html += `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`;
            }
            html += '</table>';
            modal.querySelector('.modal-body').innerHTML = html;
            bootstrap.Modal.getOrCreateInstance(modal).show();
        } catch (e) {
            App.toast('Error loading WAL header', 'danger');
        }
    }

    /* ── Reload WAL ──────────────────────────────────────────────── */
    async function reloadWal() {
        try {
            await App.apiJson('/api/wal/reload', { method: 'POST' });
            App.toast('WAL reloaded', 'success');
            switchView(currentView);
        } catch (e) {
            App.toast('Error reloading WAL', 'danger');
        }
    }

    /* ── Export CSV ───────────────────────────────────────────────── */
    function exportCsv() {
        let url;
        if (currentView === 'records') {
            const ft = document.getElementById('wal-filter-diff').value;
            url = `/api/wal/export/records-csv?filter_type=${ft}`;
        } else {
            url = '/api/wal/export/frames-csv';
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        a.click();
    }

    /* ── Utilities ───────────────────────────────────────────────── */
    function createDetailModal() {
        const div = document.createElement('div');
        div.id = 'walDetailModal';
        div.className = 'modal fade';
        div.tabIndex = -1;
        div.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">WAL Detail</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body"></div>
            </div>
        </div>`;
        document.body.appendChild(div);
        return div;
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function clear() {
        walStatus = null;
        framesData = [];
        recordsData = [];
        const content = document.getElementById('wal-data');
        if (content) content.innerHTML = '';
    }

    return { init, load, clear };
})();
