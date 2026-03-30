/* ═══════════════ DATA-GRID.JS — Resizable column data grid ═══════════════ */

const DataGrid = (() => {
    let currentTable = null;
    let columns = [];
    let rows = [];
    let totalRows = 0;
    let offset = 0;
    let pageSize = 50;
    let sortCol = null;
    let sortDir = 'ASC';
    let hasRowid = true;
    let selectedRowIdx = null;
    let selectedRows = new Set();
    let colWidths = {};
    let hiddenCols = new Set();

    const esc = TableTree.escHtml;

    async function loadTable(name) {
        currentTable = name;
        offset = 0;
        sortCol = null;
        sortDir = 'ASC';
        selectedRowIdx = null;
        selectedRows.clear();

        // Restore column visibility
        try {
            const state = await App.apiJson('/api/state');
            if (state.column_visibility && state.column_visibility[name]) {
                hiddenCols = new Set(state.column_visibility[name]);
            } else {
                hiddenCols.clear();
            }
            if (state.column_widths && state.column_widths[name]) {
                colWidths = state.column_widths[name];
            } else {
                colWidths = {};
            }
            if (state.page_size) pageSize = state.page_size;
        } catch {
            hiddenCols.clear();
            colWidths = {};
        }

        document.getElementById('page-size').value = pageSize;
        await fetchData();
    }

    async function fetchData(searchParams = null) {
        if (!currentTable) return;

        const params = new URLSearchParams({
            offset: offset,
            limit: pageSize,
        });
        if (sortCol) {
            params.set('sort_col', sortCol);
            params.set('sort_dir', sortDir);
        }
        if (searchParams) {
            if (searchParams.text) params.set('search', searchParams.text);
            if (searchParams.column) params.set('search_col', searchParams.column);
            if (searchParams.regex) params.set('regex', 'true');
        }

        try {
            const data = await App.apiJson(`/api/tables/${encodeURIComponent(currentTable)}/rows?${params}`);
            columns = data.columns;
            rows = data.rows;
            totalRows = data.total;
            hasRowid = data.has_rowid;
            renderGrid();
            renderPagination();

            // Show grid, hide empty state
            document.getElementById('data-grid').classList.add('visible');
            document.querySelector('.grid-empty')?.classList.add('d-none');
        } catch {
            App.toast('Failed to load data', 'danger');
        }
    }

    function renderGrid() {
        const headerEl = document.getElementById('grid-header');
        const bodyEl = document.getElementById('grid-body');

        // Header
        let headerHtml = '';
        for (const col of columns) {
            if (hiddenCols.has(col)) continue;
            const w = colWidths[col] || 150;
            const sortIcon = sortCol === col
                ? `<i class="bi bi-arrow-${sortDir === 'ASC' ? 'up' : 'down'} sort-icon active"></i>`
                : '<i class="bi bi-arrow-down-up sort-icon"></i>';
            headerHtml += `<div class="grid-header-cell" data-col="${esc(col)}" style="width:${w}px">
                <span class="text-truncate">${esc(col)}</span>${sortIcon}
                <div class="col-resize-handle" data-col="${esc(col)}"></div>
            </div>`;
        }
        headerEl.innerHTML = headerHtml;

        // Body
        let bodyHtml = '';
        rows.forEach((row, idx) => {
            const sel = selectedRows.has(idx) ? ' selected' : '';
            let cells = '';
            for (const col of columns) {
                if (hiddenCols.has(col)) continue;
                const w = colWidths[col] || 150;
                const val = row[col];
                if (val && typeof val === 'object' && val.__blob__) {
                    cells += `<div class="grid-cell blob-cell" data-col="${esc(col)}" style="width:${w}px" title="BLOB (${App.formatBytes(val.size)})">[BLOB: ${App.formatBytes(val.size)}]</div>`;
                } else if (val === null || val === undefined) {
                    cells += `<div class="grid-cell null-cell" data-col="${esc(col)}" style="width:${w}px">NULL</div>`;
                } else {
                    const s = String(val);
                    cells += `<div class="grid-cell" data-col="${esc(col)}" style="width:${w}px" title="${esc(s)}">${esc(s)}</div>`;
                }
            }
            bodyHtml += `<div class="grid-row${sel}" data-idx="${idx}">${cells}</div>`;
        });
        bodyEl.innerHTML = bodyHtml;

        // Sync scroll
        const body = document.getElementById('grid-body');
        body.addEventListener('scroll', () => {
            headerEl.scrollLeft = body.scrollLeft;
        });

        bindGridEvents();
    }

    function bindGridEvents() {
        // Sort on header click
        document.querySelectorAll('.grid-header-cell').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('.col-resize-handle')) return;
                const col = el.dataset.col;
                if (sortCol === col) {
                    sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';
                } else {
                    sortCol = col;
                    sortDir = 'ASC';
                }
                offset = 0;
                fetchData(Search?.getParams());
            });
        });

        // Column resize
        document.querySelectorAll('.col-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                const col = handle.dataset.col;
                const headerCell = handle.parentElement;
                const startX = e.clientX;
                const startW = headerCell.offsetWidth;

                function onMove(ev) {
                    const w = Math.max(50, startW + ev.clientX - startX);
                    colWidths[col] = w;
                    // Update header and all cells
                    headerCell.style.width = w + 'px';
                    document.querySelectorAll(`.grid-cell[data-col="${CSS.escape(col)}"]`).forEach(c => {
                        c.style.width = w + 'px';
                    });
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (currentTable) {
                        AppState.save({ column_widths: { [currentTable]: colWidths } });
                    }
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });

        // Row selection
        document.querySelectorAll('.grid-row').forEach(row => {
            row.addEventListener('click', e => {
                const idx = parseInt(row.dataset.idx);

                if (e.shiftKey && selectedRowIdx !== null) {
                    const start = Math.min(selectedRowIdx, idx);
                    const end = Math.max(selectedRowIdx, idx);
                    for (let i = start; i <= end; i++) selectedRows.add(i);
                } else if (e.ctrlKey || e.metaKey) {
                    if (selectedRows.has(idx)) selectedRows.delete(idx);
                    else selectedRows.add(idx);
                } else {
                    selectedRows.clear();
                    selectedRows.add(idx);
                }
                selectedRowIdx = idx;

                document.querySelectorAll('.grid-row').forEach(r => {
                    r.classList.toggle('selected', selectedRows.has(parseInt(r.dataset.idx)));
                });

                updateSelectionInfo();

                // Show row detail
                if (typeof RowDetail !== 'undefined') {
                    RowDetail.show(rows[idx], columns, currentTable, rows[idx]._rowid);
                }
            });

            row.addEventListener('dblclick', () => {
                const idx = parseInt(row.dataset.idx);
                if (typeof RowDetail !== 'undefined') {
                    RowDetail.show(rows[idx], columns, currentTable, rows[idx]._rowid);
                }
            });

            // BLOB cell click
            row.querySelectorAll('.blob-cell').forEach(cell => {
                cell.addEventListener('click', e => {
                    e.stopPropagation();
                    const idx = parseInt(row.dataset.idx);
                    const col = cell.dataset.col;
                    const rowid = rows[idx]._rowid;
                    if (rowid != null && typeof BlobViewer !== 'undefined') {
                        BlobViewer.open(currentTable, rowid, col);
                    }
                });
            });
        });
    }

    function renderPagination() {
        const info = document.getElementById('row-info');
        const from = totalRows > 0 ? offset + 1 : 0;
        const to = Math.min(offset + pageSize, totalRows);
        info.textContent = `${from}-${to} of ${totalRows.toLocaleString()}`;

        const totalPages = Math.ceil(totalRows / pageSize);
        const currentPage = Math.floor(offset / pageSize) + 1;

        document.getElementById('btn-page-first').disabled = currentPage <= 1;
        document.getElementById('btn-page-prev').disabled = currentPage <= 1;
        document.getElementById('btn-page-next').disabled = currentPage >= totalPages;
        document.getElementById('btn-page-last').disabled = currentPage >= totalPages;

        const pageInfo = document.getElementById('page-info');
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;

        updateSelectionInfo();
    }

    function updateSelectionInfo() {
        const el = document.getElementById('selection-info');
        if (el) {
            el.textContent = selectedRows.size > 0 ? `${selectedRows.size} selected` : '';
        }
    }

    function initPaginationControls() {
        document.getElementById('page-size')?.addEventListener('change', e => {
            pageSize = parseInt(e.target.value);
            offset = 0;
            AppState.save({ page_size: pageSize });
            fetchData(Search?.getParams());
        });
        document.getElementById('btn-page-first')?.addEventListener('click', () => { offset = 0; fetchData(Search?.getParams()); });
        document.getElementById('btn-page-prev')?.addEventListener('click', () => { offset = Math.max(0, offset - pageSize); fetchData(Search?.getParams()); });
        document.getElementById('btn-page-next')?.addEventListener('click', () => { offset += pageSize; fetchData(Search?.getParams()); });
        document.getElementById('btn-page-last')?.addEventListener('click', () => { offset = Math.max(0, (Math.ceil(totalRows / pageSize) - 1) * pageSize); fetchData(Search?.getParams()); });
    }

    function clear() {
        currentTable = null;
        columns = [];
        rows = [];
        totalRows = 0;
        document.getElementById('data-grid')?.classList.remove('visible');
        document.querySelector('.grid-empty')?.classList.remove('d-none');
        document.getElementById('grid-header').innerHTML = '';
        document.getElementById('grid-body').innerHTML = '';
        if (typeof RowDetail !== 'undefined') RowDetail.hide();
    }

    function getSelectedRows() {
        return [...selectedRows].map(i => rows[i]).filter(Boolean);
    }

    function getCurrentTable() { return currentTable; }
    function getColumns() { return columns; }
    function getRows() { return rows; }

    return { init: initPaginationControls, loadTable, fetchData, clear, getSelectedRows, getCurrentTable, getColumns, getRows, renderGrid };
})();
