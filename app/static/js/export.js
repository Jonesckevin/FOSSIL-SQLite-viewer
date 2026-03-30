/* Export Manager — Exports tab with list, create, download, delete */
var ExportManager = (function () {
    'use strict';

    function init() {
        const tab = document.getElementById('tab-exports');
        if (!tab) return;
        tab.addEventListener('shown.bs.tab', () => load());

        const container = document.getElementById('exports-content');
        if (!container) return;

        container.innerHTML = `
        <div class="d-flex align-items-center gap-2 p-2 border-bottom">
            <button class="btn btn-sm btn-outline-secondary" id="export-refresh-btn">
                <i class="bi bi-arrow-clockwise"></i> Refresh
            </button>
            <div class="ms-auto d-flex gap-1 align-items-center">
                <select class="form-select form-select-sm" id="export-format" style="width:auto">
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                    <option value="sql">SQL</option>
                </select>
                <button class="btn btn-sm btn-primary" id="export-table-btn">
                    <i class="bi bi-download"></i> Export Table
                </button>
            </div>
        </div>
        <div id="export-list" class="p-2"></div>
        `;

        document.getElementById('export-refresh-btn').addEventListener('click', load);
        document.getElementById('export-table-btn').addEventListener('click', exportCurrentTable);
    }

    async function load() {
        const list = document.getElementById('export-list');
        if (!list) return;

        try {
            const data = await App.apiJson('/api/exports');
            renderList(data.exports);
        } catch (e) {
            list.innerHTML = '<div class="text-muted py-3 text-center">No exports yet.</div>';
        }
    }

    function renderList(exports) {
        const list = document.getElementById('export-list');

        if (!exports.length) {
            list.innerHTML = '<div class="text-muted py-3 text-center">No exports yet. Use "Export Table" to create one.</div>';
            return;
        }

        let html = '<div class="list-group list-group-flush">';
        for (const ex of exports) {
            html += `<div class="list-group-item d-flex align-items-center gap-2 export-item">
                <i class="bi bi-file-earmark-text"></i>
                <div class="flex-grow-1">
                    <div class="fw-medium">${esc(ex.name)}</div>
                    <small class="text-muted">${App.formatBytes(ex.size)} &middot; ${new Date(ex.modified).toLocaleString()}</small>
                </div>
                <a class="btn btn-sm btn-outline-primary" href="/api/exports/download/${encodeURIComponent(ex.name)}" download title="Download">
                    <i class="bi bi-download"></i>
                </a>
                <button class="btn btn-sm btn-outline-danger export-delete-btn" data-name="${esc(ex.name)}" title="Delete">
                    <i class="bi bi-trash"></i>
                </button>
            </div>`;
        }
        html += '</div>';
        list.innerHTML = html;

        list.querySelectorAll('.export-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteExport(btn.dataset.name));
        });
    }

    async function exportCurrentTable() {
        // Get the currently selected table from the tree
        const activeItem = document.querySelector('.tree-item.active');
        if (!activeItem) {
            App.toast('Select a table first', 'warning');
            return;
        }
        const table = activeItem.dataset.table;
        const format = document.getElementById('export-format').value;

        try {
            const data = await App.apiJson('/api/exports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table, format }),
            });
            App.toast(`Exported: ${data.filename}`, 'success');
            load();
        } catch (e) {
            App.toast(`Export failed: ${e.message}`, 'danger');
        }
    }

    async function deleteExport(name) {
        try {
            await App.apiJson(`/api/exports/${encodeURIComponent(name)}`, { method: 'DELETE' });
            App.toast('Deleted', 'success');
            load();
        } catch (e) {
            App.toast('Delete failed', 'danger');
        }
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function exportSelectedCsv(rows, columns, table) {
        const header = columns.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',');
        const lines = rows.map(row =>
            columns.map(c => {
                const v = row[c];
                if (v == null) return '';
                const s = String(v);
                return '"' + s.replace(/"/g, '""') + '"';
            }).join(',')
        );
        const csv = [header, ...lines].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (table || 'export') + '_selected.csv';
        a.click();
        URL.revokeObjectURL(url);
        App.toast(`Exported ${rows.length} rows as CSV`, 'success');
    }

    return { init, load, exportSelectedCsv };
})();
