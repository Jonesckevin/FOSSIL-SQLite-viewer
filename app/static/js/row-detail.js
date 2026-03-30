/* ═══════════════ ROW-DETAIL.JS — Bottom pane row detail view ═══════════════ */

const RowDetail = (() => {
    const esc = TableTree.escHtml;
    let currentRow = null;
    let currentCols = null;
    let currentTable = null;
    let currentRowid = null;
    let visible = false;

    function show(row, cols, table, rowid) {
        currentRow = row;
        currentCols = cols;
        currentTable = table;
        currentRowid = rowid;

        const panel = document.getElementById('row-detail-panel');
        const body = document.getElementById('row-detail-body');
        if (!panel || !body) return;

        let html = '';
        for (const col of cols) {
            if (col === '_rowid') continue;
            const val = row[col];
            let valueHtml;
            let extraHtml = '';

            if (val && typeof val === 'object' && val.__blob__) {
                valueHtml = `<span class="detail-field-value blob-link" data-col="${esc(col)}">[BLOB: ${App.formatBytes(val.size)}] — Click to view</span>`;
            } else if (val === null || val === undefined) {
                valueHtml = '<span class="detail-field-value null-cell">NULL</span>';
            } else {
                valueHtml = `<span class="detail-field-value">${esc(String(val))}</span>`;
                // Auto-decode timestamps for numeric values
                if (typeof val === 'number' && typeof Decode !== 'undefined') {
                    extraHtml = `<div class="detail-field-decode" data-value="${val}" data-col="${esc(col)}"></div>`;
                }
            }

            html += `<div class="detail-field" data-col="${esc(col)}">
                <div class="detail-field-name">${esc(col)}</div>
                ${valueHtml}
                ${extraHtml}
            </div>`;
        }
        body.innerHTML = html;

        // Bind BLOB clicks
        body.querySelectorAll('.blob-link').forEach(el => {
            el.addEventListener('click', () => {
                const col = el.dataset.col;
                if (currentRowid != null && typeof BlobViewer !== 'undefined') {
                    BlobViewer.open(currentTable, currentRowid, col);
                }
            });
        });

        // Auto-decode numeric fields
        body.querySelectorAll('.detail-field-decode').forEach(el => {
            const val = parseFloat(el.dataset.value);
            if (!isNaN(val) && typeof Decode !== 'undefined') {
                Decode.inlineDecode(val, el);
            }
        });

        panel.classList.remove('d-none');
        visible = true;
        initResize();
    }

    function hide() {
        const panel = document.getElementById('row-detail-panel');
        if (panel) panel.classList.add('d-none');
        visible = false;
    }

    // ── Resize handle ────────────────────────────────────────
    function initResize() {
        const handle = document.getElementById('detail-resize');
        const panel = document.getElementById('row-detail-panel');
        if (!handle || !panel) return;

        // Remove old listeners by cloning
        const newHandle = handle.cloneNode(true);
        handle.parentNode.replaceChild(newHandle, handle);

        newHandle.addEventListener('mousedown', e => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = panel.offsetHeight;
            newHandle.classList.add('active');

            function onMove(ev) {
                const h = Math.max(100, Math.min(window.innerHeight * 0.6, startH - (ev.clientY - startY)));
                panel.style.height = h + 'px';
            }
            function onUp() {
                newHandle.classList.remove('active');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                AppState.save({ detail_height: panel.offsetHeight });
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Copy buttons ─────────────────────────────────────────
    function initCopyButtons() {
        document.getElementById('btn-copy-json')?.addEventListener('click', () => {
            if (!currentRow) return;
            const clean = {};
            for (const [k, v] of Object.entries(currentRow)) {
                if (k === '_rowid') continue;
                if (v && typeof v === 'object' && v.__blob__) clean[k] = `[BLOB: ${v.size} bytes]`;
                else clean[k] = v;
            }
            ContextMenu.copyText(JSON.stringify(clean, null, 2));
            App.toast('Copied as JSON', 'success');
        });

        document.getElementById('btn-copy-csv')?.addEventListener('click', () => {
            if (!currentRow || !currentCols) return;
            const header = currentCols.filter(c => c !== '_rowid').join(',');
            const values = currentCols.filter(c => c !== '_rowid').map(c => {
                const v = currentRow[c];
                if (v && typeof v === 'object' && v.__blob__) return '[BLOB]';
                if (v === null || v === undefined) return '';
                const s = String(v);
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(',');
            ContextMenu.copyText(header + '\n' + values);
            App.toast('Copied as CSV', 'success');
        });

        document.getElementById('btn-copy-text')?.addEventListener('click', () => {
            if (!currentRow || !currentCols) return;
            const lines = currentCols.filter(c => c !== '_rowid').map(c => {
                const v = currentRow[c];
                if (v && typeof v === 'object' && v.__blob__) return `${c}: [BLOB: ${v.size} bytes]`;
                return `${c}: ${v ?? 'NULL'}`;
            });
            ContextMenu.copyText(lines.join('\n'));
            App.toast('Copied as text', 'success');
        });
    }

    return { init: initCopyButtons, show, hide, get visible() { return visible; } };
})();
