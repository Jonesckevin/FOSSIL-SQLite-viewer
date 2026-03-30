/* ═══════════════ CONTEXT-MENU.JS — Right-click context menu ═══════════════ */

const ContextMenu = (() => {
    const menu = document.getElementById('context-menu');
    let targetRow = null;
    let targetCol = null;
    let targetRowIdx = null;

    function init() {
        // Grid body right-click
        document.getElementById('grid-body')?.addEventListener('contextmenu', e => {
            e.preventDefault();
            const cell = e.target.closest('.grid-cell');
            const row = e.target.closest('.grid-row');
            if (!row) { hide(); return; }

            targetRowIdx = parseInt(row.dataset.idx);
            targetCol = cell?.dataset.col || null;
            targetRow = DataGrid.getRows()[targetRowIdx];

            // Show/hide BLOB option
            const blobItem = document.querySelector('#context-menu [data-action="view-blob"]');
            if (blobItem) {
                const val = targetRow?.[targetCol];
                blobItem.classList.toggle('d-none', !(val && typeof val === 'object' && val.__blob__));
            }

            show(e.clientX, e.clientY);
        });

        // Hide on click elsewhere
        document.addEventListener('click', hide);
        document.addEventListener('contextmenu', e => {
            if (!e.target.closest('#grid-body')) hide();
        });

        // Menu item actions
        bindAction('copy-cell', copyCell);
        bindAction('copy-row-csv', copyRowCsv);
        bindAction('copy-row-json', copyRowJson);
        bindAction('copy-column', copyColumn);
        bindAction('export-selected', exportSelected);
        bindAction('view-detail', viewDetail);
        bindAction('view-blob', viewBlob);
        bindAction('decode-value', decodeValue);
    }

    function bindAction(action, fn) {
        document.querySelector(`#context-menu [data-action="${action}"]`)?.addEventListener('click', e => {
            e.stopPropagation();
            hide();
            fn();
        });
    }

    function show(x, y) {
        if (!menu) return;
        menu.style.display = 'block';
        // Ensure it stays within viewport
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        menu.style.left = (x + mw > vw ? vw - mw - 4 : x) + 'px';
        menu.style.top = (y + mh > vh ? vh - mh - 4 : y) + 'px';
    }

    function hide() {
        if (menu) menu.style.display = 'none';
    }

    // ── Actions ──────────────────────────────────────────────

    function copyCell() {
        if (!targetRow || !targetCol) return;
        const val = targetRow[targetCol];
        const text = val && typeof val === 'object' && val.__blob__ ? `[BLOB: ${val.size} bytes]` : String(val ?? '');
        copyText(text);
        App.toast('Cell copied', 'success');
    }

    function copyRowCsv() {
        if (!targetRow) return;
        const cols = DataGrid.getColumns();
        const header = cols.join(',');
        const values = cols.map(c => {
            const v = targetRow[c];
            if (v && typeof v === 'object' && v.__blob__) return `[BLOB]`;
            if (v === null || v === undefined) return '';
            const s = String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',');
        copyText(header + '\n' + values);
        App.toast('Row copied as CSV', 'success');
    }

    function copyRowJson() {
        if (!targetRow) return;
        const clean = {};
        for (const [k, v] of Object.entries(targetRow)) {
            if (k === '_rowid') continue;
            if (v && typeof v === 'object' && v.__blob__) clean[k] = `[BLOB: ${v.size} bytes]`;
            else clean[k] = v;
        }
        copyText(JSON.stringify(clean, null, 2));
        App.toast('Row copied as JSON', 'success');
    }

    function copyColumn() {
        if (!targetCol) return;
        const rows = DataGrid.getRows();
        const values = rows.map(r => {
            const v = r[targetCol];
            if (v && typeof v === 'object' && v.__blob__) return '[BLOB]';
            return String(v ?? '');
        });
        copyText(values.join('\n'));
        App.toast('Column copied', 'success');
    }

    function exportSelected() {
        const selected = DataGrid.getSelectedRows();
        if (!selected.length) return App.toast('No rows selected', 'warning');
        if (typeof ExportManager !== 'undefined') {
            ExportManager.exportSelectedCsv(selected, DataGrid.getColumns(), DataGrid.getCurrentTable());
        }
    }

    function viewDetail() {
        if (!targetRow) return;
        if (typeof RowDetail !== 'undefined') {
            RowDetail.show(targetRow, DataGrid.getColumns(), DataGrid.getCurrentTable(), targetRow._rowid);
        }
    }

    function viewBlob() {
        if (!targetRow || !targetCol) return;
        const rowid = targetRow._rowid;
        if (rowid != null && typeof BlobViewer !== 'undefined') {
            BlobViewer.open(DataGrid.getCurrentTable(), rowid, targetCol);
        }
    }

    function decodeValue() {
        if (!targetRow || !targetCol) return;
        const val = targetRow[targetCol];
        if (typeof Decode !== 'undefined') {
            Decode.open(val, targetCol);
        }
    }

    function copyText(text) {
        navigator.clipboard.writeText(text).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    return { init, hide, copyText };
})();
