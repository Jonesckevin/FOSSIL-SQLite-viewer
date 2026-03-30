/* ═══════════════ SEARCH.JS — Search + SQL Query Mode ═══════════════ */

const Search = (() => {
    let debounceTimer = null;
    let sqlMode = false;
    let savedQueries = [];

    /* ── Known SQL keywords / functions for autocomplete & highlighting ── */
    const SQL_KEYWORDS = [
        'SELECT','FROM','WHERE','AND','OR','NOT','IN','BETWEEN','LIKE','GLOB',
        'IS','NULL','AS','ON','JOIN','INNER','LEFT','RIGHT','CROSS','OUTER',
        'ORDER','BY','ASC','DESC','GROUP','HAVING','LIMIT','OFFSET','UNION',
        'ALL','DISTINCT','EXISTS','CASE','WHEN','THEN','ELSE','END','CAST',
        'WITH','RECURSIVE','EXCEPT','INTERSECT','PRAGMA','EXPLAIN','QUERY','PLAN',
        'VALUES','INTO','TRUE','FALSE'
    ];
    const SQL_FUNCTIONS = [
        'COUNT','SUM','AVG','MIN','MAX','GROUP_CONCAT','TOTAL',
        'LENGTH','UPPER','LOWER','SUBSTR','REPLACE','TRIM','LTRIM','RTRIM',
        'INSTR','TYPEOF','COALESCE','IFNULL','NULLIF','IIF',
        'ABS','ROUND','RANDOM','HEX','ZEROBLOB','QUOTE','UNICODE',
        'DATE','TIME','DATETIME','JULIANDAY','STRFTIME',
        'PRINTF','CHAR','LIKELIHOOD','LIKELY','UNLIKELY'
    ];
    const SQL_OPERATORS_RE = /\b(AND|OR|NOT|IN|BETWEEN|LIKE|GLOB|IS|EXISTS)\b/gi;

    /* ── Syntax highlighting ───────────────────────────── */
    const KW_SET  = new Set(SQL_KEYWORDS.map(k => k.toUpperCase()));
    const FN_SET  = new Set(SQL_FUNCTIONS.map(f => f.toUpperCase()));
    let knownTables = new Set();
    let knownColumns = new Set();

    function highlightSql(sql) {
        // tokenize respecting strings, comments, words, numbers, operators
        const tokens = [];
        let i = 0;
        while (i < sql.length) {
            // Single-line comment
            if (sql[i] === '-' && sql[i+1] === '-') {
                let end = sql.indexOf('\n', i);
                if (end === -1) end = sql.length;
                tokens.push({ type: 'comment', text: sql.slice(i, end) });
                i = end;
                continue;
            }
            // String literal
            if (sql[i] === "'") {
                let j = i + 1;
                while (j < sql.length) {
                    if (sql[j] === "'" && sql[j+1] === "'") { j += 2; continue; }
                    if (sql[j] === "'") { j++; break; }
                    j++;
                }
                tokens.push({ type: 'str', text: sql.slice(i, j) });
                i = j;
                continue;
            }
            // Double-quoted identifier
            if (sql[i] === '"') {
                let j = i + 1;
                while (j < sql.length && sql[j] !== '"') j++;
                if (j < sql.length) j++;
                tokens.push({ type: 'ident', text: sql.slice(i, j) });
                i = j;
                continue;
            }
            // Number
            if (/\d/.test(sql[i])) {
                let j = i;
                while (j < sql.length && /[\d.eE]/.test(sql[j])) j++;
                tokens.push({ type: 'num', text: sql.slice(i, j) });
                i = j;
                continue;
            }
            // Word
            if (/[a-zA-Z_]/.test(sql[i])) {
                let j = i;
                while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++;
                tokens.push({ type: 'word', text: sql.slice(i, j) });
                i = j;
                continue;
            }
            // Whitespace
            if (/\s/.test(sql[i])) {
                let j = i;
                while (j < sql.length && /\s/.test(sql[j])) j++;
                tokens.push({ type: 'ws', text: sql.slice(i, j) });
                i = j;
                continue;
            }
            // Any other char (operators, punctuation)
            tokens.push({ type: 'other', text: sql[i] });
            i++;
        }

        // Classify and build highlighted HTML
        let html = '';
        for (const tok of tokens) {
            const escaped = escHtml(tok.text);
            switch (tok.type) {
                case 'comment':
                    html += `<span class="sql-comment">${escaped}</span>`;
                    break;
                case 'str':
                    html += `<span class="sql-str">${escaped}</span>`;
                    break;
                case 'num':
                    html += `<span class="sql-num">${escaped}</span>`;
                    break;
                case 'word': {
                    const upper = tok.text.toUpperCase();
                    if (KW_SET.has(upper))
                        html += `<span class="sql-kw">${escaped}</span>`;
                    else if (FN_SET.has(upper))
                        html += `<span class="sql-fn">${escaped}</span>`;
                    else if (knownTables.has(tok.text) || knownTables.has(upper))
                        html += `<span class="sql-tbl">${escaped}</span>`;
                    else if (knownColumns.has(tok.text) || knownColumns.has(upper))
                        html += `<span class="sql-col">${escaped}</span>`;
                    else
                        html += `<span class="sql-plain">${escaped}</span>`;
                    break;
                }
                case 'ident':
                    html += `<span class="sql-tbl">${escaped}</span>`;
                    break;
                default:
                    html += `<span class="sql-plain">${escaped}</span>`;
            }
        }
        return html;
    }

    function syncHighlight() {
        const editor = document.getElementById('sql-editor');
        const highlight = document.getElementById('sql-highlight');
        if (!editor || !highlight) return;
        // Sync content — add trailing newline so scrolling matches
        highlight.innerHTML = highlightSql(editor.value) + '\n';
        // Sync scroll position
        highlight.scrollTop = editor.scrollTop;
        highlight.scrollLeft = editor.scrollLeft;
    }

    /* ── Autocomplete ──────────────────────────────────── */
    let acIndex = -1;   // active item index
    let acItems = [];   // currently shown items

    function buildCompletionList() {
        // Combine keywords, functions, table names, column names
        const items = [];
        for (const kw of SQL_KEYWORDS) items.push({ label: kw, type: 'kw' });
        for (const fn of SQL_FUNCTIONS) items.push({ label: fn + '()', type: 'fn' });
        for (const t of knownTables) items.push({ label: t, type: 'tbl' });
        for (const c of knownColumns) items.push({ label: c, type: 'col' });
        return items;
    }

    function showAutocomplete() {
        const editor = document.getElementById('sql-editor');
        const ac = document.getElementById('sql-autocomplete');
        if (!editor || !ac) return;

        const cursorPos = editor.selectionStart;
        const textBefore = editor.value.slice(0, cursorPos);

        // Extract the word being typed (last word fragment)
        const match = textBefore.match(/[a-zA-Z_]\w*$/);
        if (!match || match[0].length < 1) {
            hideAutocomplete();
            return;
        }

        const prefix = match[0].toUpperCase();
        const allItems = buildCompletionList();
        acItems = allItems.filter(it => {
            const lbl = it.label.toUpperCase();
            return lbl.startsWith(prefix) && lbl !== prefix;
        });

        // Deduplicate by label
        const seen = new Set();
        acItems = acItems.filter(it => {
            const key = it.label.toUpperCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (!acItems.length) { hideAutocomplete(); return; }

        // Cap at 15 items
        acItems = acItems.slice(0, 15);
        acIndex = 0;

        // Position the dropdown below the cursor
        const rect = editor.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 18;

        // Rough cursor line/col estimation
        const lines = textBefore.split('\n');
        const line = lines.length - 1;
        const col = lines[lines.length - 1].length;
        const charWidth = 7.5; // approximate

        ac.style.top = Math.min((line + 1) * lineHeight + 4, editor.offsetHeight) + 'px';
        ac.style.left = Math.min(col * charWidth, editor.offsetWidth - 200) + 'px';

        renderAutocomplete(ac);
        ac.classList.remove('d-none');
    }

    function renderAutocomplete(ac) {
        const badgeClass = { kw: 'sql-ac-badge-kw', fn: 'sql-ac-badge-fn', tbl: 'sql-ac-badge-tbl', col: 'sql-ac-badge-col' };
        const badgeLabel = { kw: 'key', fn: 'func', tbl: 'table', col: 'col' };

        let html = '';
        acItems.forEach((item, idx) => {
            const cls = idx === acIndex ? ' active' : '';
            html += `<div class="sql-ac-item${cls}" data-idx="${idx}">
                <span class="sql-ac-badge ${badgeClass[item.type] || ''}">${badgeLabel[item.type] || ''}</span>
                <span>${escHtml(item.label)}</span>
            </div>`;
        });
        ac.innerHTML = html;

        // Click to select
        ac.querySelectorAll('.sql-ac-item').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                applyAutocomplete(parseInt(el.dataset.idx));
            });
        });
    }

    function applyAutocomplete(idx) {
        const item = acItems[idx];
        if (!item) return;

        const editor = document.getElementById('sql-editor');
        const cursorPos = editor.selectionStart;
        const textBefore = editor.value.slice(0, cursorPos);
        const textAfter = editor.value.slice(cursorPos);

        const match = textBefore.match(/[a-zA-Z_]\w*$/);
        const prefixLen = match ? match[0].length : 0;
        const beforePrefix = textBefore.slice(0, textBefore.length - prefixLen);

        // For table names with spaces, wrap in quotes
        let insertText = item.label;
        if (item.type === 'tbl' && /\s/.test(insertText)) {
            insertText = `"${insertText}"`;
        }

        editor.value = beforePrefix + insertText + textAfter;
        const newPos = beforePrefix.length + insertText.length;
        editor.selectionStart = editor.selectionEnd = newPos;
        editor.focus();

        hideAutocomplete();
        syncHighlight();
    }

    function hideAutocomplete() {
        const ac = document.getElementById('sql-autocomplete');
        if (ac) { ac.classList.add('d-none'); ac.innerHTML = ''; }
        acIndex = -1;
        acItems = [];
    }

    function handleAcKeydown(e) {
        const ac = document.getElementById('sql-autocomplete');
        if (!ac || ac.classList.contains('d-none') || !acItems.length) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acIndex = (acIndex + 1) % acItems.length;
            renderAutocomplete(ac);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            acIndex = (acIndex - 1 + acItems.length) % acItems.length;
            renderAutocomplete(ac);
            return true;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            // Tab/Enter completes; but if Enter + Ctrl, let it execute
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return false;
            e.preventDefault();
            applyAutocomplete(acIndex >= 0 ? acIndex : 0);
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            hideAutocomplete();
            return true;
        }
        return false;
    }

    /* ── Table/Column insert selectors ─────────────────── */

    function populateInsertSelectors() {
        const tableSel = document.getElementById('sql-insert-table');
        const colSel = document.getElementById('sql-insert-column');
        if (!tableSel) return;

        const tables = typeof TableTree !== 'undefined' ? TableTree.getTables() : [];
        tableSel.innerHTML = '<option value="">+ Table…</option>';
        for (const t of tables) {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            tableSel.appendChild(opt);
        }

        // Reset columns
        if (colSel) colSel.innerHTML = '<option value="">+ Column…</option>';

        // Update known sets for highlighting
        knownTables = new Set(tables.map(t => t.name));
        knownColumns = new Set();
    }

    async function onInsertTableChange() {
        const tableSel = document.getElementById('sql-insert-table');
        const colSel = document.getElementById('sql-insert-column');
        const tableName = tableSel?.value;

        if (tableName) {
            insertAtCursor(tableName.includes(' ') ? `"${tableName}"` : tableName);
            tableSel.value = ''; // reset dropdown

            // Also populate columns for this table
            if (colSel) {
                colSel.innerHTML = '<option value="">+ Column…</option>';
                try {
                    const schema = await App.apiJson(`/api/tables/${encodeURIComponent(tableName)}/schema`);
                    const cols = schema.columns || [];
                    knownColumns = new Set(cols.map(c => c.name));
                    for (const c of cols) {
                        const opt = document.createElement('option');
                        opt.value = c.name;
                        opt.textContent = `${c.name} (${c.type || '?'})`;
                        colSel.appendChild(opt);
                    }
                } catch { /* ignore */ }
            }
        }
        syncHighlight();
    }

    function onInsertColumnChange() {
        const colSel = document.getElementById('sql-insert-column');
        const colName = colSel?.value;
        if (colName) {
            insertAtCursor(colName.includes(' ') ? `"${colName}"` : colName);
            colSel.value = '';
        }
        syncHighlight();
    }

    function insertAtCursor(text) {
        const editor = document.getElementById('sql-editor');
        if (!editor) return;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const before = editor.value.slice(0, start);
        const after = editor.value.slice(end);

        // Add a space before if the previous char isn't whitespace or empty
        const needSpace = before.length > 0 && !/\s$/.test(before);
        const insert = (needSpace ? ' ' : '') + text;

        editor.value = before + insert + after;
        const newPos = start + insert.length;
        editor.selectionStart = editor.selectionEnd = newPos;
        editor.focus();
        syncHighlight();
    }

    /* ── Init ──────────────────────────────────────────── */

    function init() {
        const input = document.getElementById('search-input');
        const regexCb = document.getElementById('search-regex');
        const tableSelect = document.getElementById('search-table');
        const colSelect = document.getElementById('search-column');
        const clearBtn = document.getElementById('btn-search-clear');
        const sqlToggle = document.getElementById('btn-sql-mode');

        // Populate table dropdown
        populateTables();

        // Table selector changes column list
        tableSelect?.addEventListener('change', () => {
            const table = tableSelect.value;
            if (table) {
                updateColumns(table);
                if (typeof TableTree !== 'undefined' && table !== TableTree.getActive()) {
                    TableTree.select(table);
                }
            } else {
                colSelect.innerHTML = '<option value="">All columns</option>';
            }
        });

        // Debounced search on typing
        input?.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(doSearch, 300);
        });

        // Immediate search on enter
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                clearTimeout(debounceTimer);
                doSearch();
            }
        });

        // Regex toggle triggers search
        regexCb?.addEventListener('change', doSearch);

        // Clear button
        clearBtn?.addEventListener('click', () => {
            input.value = '';
            regexCb.checked = false;
            colSelect.innerHTML = '<option value="">All columns</option>';
            doSearch();
        });

        // SQL mode toggle
        sqlToggle?.addEventListener('click', () => toggleSqlMode());

        // SQL editor events
        const sqlEditor = document.getElementById('sql-editor');

        // Syntax highlighting sync
        sqlEditor?.addEventListener('input', () => {
            syncHighlight();
            showAutocomplete();
        });
        sqlEditor?.addEventListener('scroll', syncHighlight);

        // Autocomplete keyboard navigation
        sqlEditor?.addEventListener('keydown', e => {
            // First check autocomplete navigation
            if (handleAcKeydown(e)) return;

            // Ctrl+Enter to execute
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                executeSql();
            }
        });

        // Hide autocomplete on blur (delayed to allow click)
        sqlEditor?.addEventListener('blur', () => {
            setTimeout(hideAutocomplete, 150);
        });

        // Button events
        document.getElementById('btn-sql-execute')?.addEventListener('click', executeSql);
        document.getElementById('btn-sql-save')?.addEventListener('click', saveSqlQuery);
        document.getElementById('btn-sql-export-queries')?.addEventListener('click', exportSavedQueries);
        document.getElementById('sql-saved-select')?.addEventListener('change', loadSavedQuery);

        // Table/Column insert selectors
        document.getElementById('sql-insert-table')?.addEventListener('change', onInsertTableChange);
        document.getElementById('sql-insert-column')?.addEventListener('change', onInsertColumnChange);
    }

    // ── SQL Mode toggle ─────────────────────────────────────

    function toggleSqlMode(force) {
        sqlMode = force !== undefined ? force : !sqlMode;
        const searchControls = document.getElementById('search-controls');
        const sqlPanel = document.getElementById('sql-query-panel');
        const toggle = document.getElementById('btn-sql-mode');

        if (sqlMode) {
            searchControls?.classList.add('d-none');
            sqlPanel?.classList.remove('d-none');
            toggle?.classList.add('active');

            // Set default query based on current table
            const editor = document.getElementById('sql-editor');
            if (editor && !editor.value.trim()) {
                const table = DataGrid.getCurrentTable();
                if (table) {
                    const safe = table.replace(/"/g, '""');
                    editor.value = `SELECT * FROM "${safe}"`;
                } else {
                    editor.value = 'SELECT * FROM ';
                }
            }

            populateInsertSelectors();
            loadSavedQueryList();
            syncHighlight();

            // Also load columns for current table to aid highlighting
            const currentTable = DataGrid.getCurrentTable();
            if (currentTable) {
                App.apiJson(`/api/tables/${encodeURIComponent(currentTable)}/schema`).then(schema => {
                    const cols = schema.columns || [];
                    knownColumns = new Set(cols.map(c => c.name));
                    // Update column insert dropdown
                    const colSel = document.getElementById('sql-insert-column');
                    if (colSel) {
                        colSel.innerHTML = '<option value="">+ Column…</option>';
                        for (const c of cols) {
                            const opt = document.createElement('option');
                            opt.value = c.name;
                            opt.textContent = `${c.name} (${c.type || '?'})`;
                            colSel.appendChild(opt);
                        }
                    }
                    syncHighlight();
                }).catch(() => {});
            }
        } else {
            searchControls?.classList.remove('d-none');
            sqlPanel?.classList.add('d-none');
            toggle?.classList.remove('active');
            hideAutocomplete();

            // Re-fetch normal table data
            if (typeof DataGrid !== 'undefined' && DataGrid.getCurrentTable()) {
                DataGrid.fetchData(getParams());
            }
        }
    }

    // ── SQL execution ───────────────────────────────────────

    async function executeSql() {
        const editor = document.getElementById('sql-editor');
        const sql = editor?.value?.trim();
        if (!sql) {
            App.toast('Enter a SQL query', 'warning');
            return;
        }

        hideAutocomplete();

        const statusEl = document.getElementById('sql-status');
        statusEl.textContent = 'Executing…';
        statusEl.className = 'sql-status text-muted';

        try {
            const data = await App.apiJson('/api/sql/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql }),
            });

            // Render results in the grid
            renderSqlResults(data);

            const truncMsg = data.truncated ? ' (truncated — add LIMIT to control)' : '';
            statusEl.textContent = `${data.total} row${data.total !== 1 ? 's' : ''} returned${truncMsg}`;
            statusEl.className = 'sql-status text-success';
        } catch (e) {
            statusEl.textContent = e.message || 'Query failed';
            statusEl.className = 'sql-status text-danger';
        }
    }

    function renderSqlResults(data) {
        // Directly render into the data grid
        const headerEl = document.getElementById('grid-header');
        const bodyEl = document.getElementById('grid-body');
        if (!headerEl || !bodyEl) return;

        const columns = data.columns || [];
        const rows = data.rows || [];

        // Show grid, hide empty state
        document.getElementById('data-grid')?.classList.add('visible');
        document.querySelector('.grid-empty')?.classList.add('d-none');

        // Header
        let headerHtml = '';
        for (const col of columns) {
            headerHtml += `<div class="grid-header-cell" data-col="${escHtml(col)}" style="width:150px">
                <span class="text-truncate">${escHtml(col)}</span>
            </div>`;
        }
        headerEl.innerHTML = headerHtml;

        // Body
        let bodyHtml = '';
        rows.forEach((row, idx) => {
            let cells = '';
            for (const col of columns) {
                const val = row[col];
                if (val && typeof val === 'object' && val.__blob__) {
                    cells += `<div class="grid-cell blob-cell" data-col="${escHtml(col)}" style="width:150px">[BLOB: ${App.formatBytes(val.size)}]</div>`;
                } else if (val === null || val === undefined) {
                    cells += `<div class="grid-cell null-cell" data-col="${escHtml(col)}" style="width:150px">NULL</div>`;
                } else {
                    const s = String(val);
                    cells += `<div class="grid-cell" data-col="${escHtml(col)}" style="width:150px" title="${escHtml(s)}">${escHtml(s)}</div>`;
                }
            }
            bodyHtml += `<div class="grid-row" data-idx="${idx}">${cells}</div>`;
        });
        bodyEl.innerHTML = bodyHtml;

        // Sync scroll
        const body = document.getElementById('grid-body');
        body.addEventListener('scroll', () => { headerEl.scrollLeft = body.scrollLeft; });

        // Update pagination area for SQL results
        const info = document.getElementById('row-info');
        if (info) info.textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''}`;
        const pageInfo = document.getElementById('page-info');
        if (pageInfo) pageInfo.textContent = 'SQL Query';
        ['btn-page-first', 'btn-page-prev', 'btn-page-next', 'btn-page-last'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });
    }

    // ── Saved queries ───────────────────────────────────────

    async function loadSavedQueryList() {
        try {
            const data = await App.apiJson('/api/sql/saved');
            savedQueries = data.queries || [];
        } catch {
            savedQueries = [];
        }

        const sel = document.getElementById('sql-saved-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Saved Queries —</option>';
        for (const q of savedQueries) {
            const opt = document.createElement('option');
            opt.value = q.id;
            opt.textContent = q.name;
            if (q.description) opt.title = q.description;
            sel.appendChild(opt);
        }

        // Show/hide delete button
        updateDeleteBtn();
    }

    function loadSavedQuery() {
        const sel = document.getElementById('sql-saved-select');
        const id = sel?.value;
        if (!id) return;

        const q = savedQueries.find(x => x.id === id);
        if (!q) return;

        const editor = document.getElementById('sql-editor');
        if (editor) editor.value = q.sql;

        document.getElementById('sql-status').textContent = `Loaded: ${q.name}`;
        document.getElementById('sql-status').className = 'sql-status text-muted';
        updateDeleteBtn();
        syncHighlight();
    }

    async function saveSqlQuery() {
        const editor = document.getElementById('sql-editor');
        const sql = editor?.value?.trim();
        if (!sql) {
            App.toast('Enter a query before saving', 'warning');
            return;
        }

        const name = prompt('Query name:');
        if (!name || !name.trim()) return;

        const description = prompt('Description (optional):', '') || '';

        try {
            await App.apiJson('/api/sql/saved', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), sql, description }),
            });
            App.toast(`Saved: ${name.trim()}`, 'success');
            await loadSavedQueryList();
        } catch (e) {
            App.toast(`Save failed: ${e.message}`, 'danger');
        }
    }

    async function deleteSavedQuery() {
        const sel = document.getElementById('sql-saved-select');
        const id = sel?.value;
        if (!id) return;

        const q = savedQueries.find(x => x.id === id);
        if (!q || !confirm(`Delete saved query "${q.name}"?`)) return;

        try {
            await App.apiJson(`/api/sql/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
            App.toast('Deleted', 'success');
            await loadSavedQueryList();
        } catch (e) {
            App.toast('Delete failed', 'danger');
        }
    }

    function updateDeleteBtn() {
        const btn = document.getElementById('btn-sql-delete-query');
        const sel = document.getElementById('sql-saved-select');
        if (btn) btn.disabled = !sel?.value;
    }

    function exportSavedQueries() {
        const a = document.createElement('a');
        a.href = '/api/sql/saved/export';
        a.download = 'saved_queries.json';
        a.click();
    }

    // ── Normal search ───────────────────────────────────────

    function populateTables() {
        const sel = document.getElementById('search-table');
        if (!sel) return;

        const tables = typeof TableTree !== 'undefined' ? TableTree.getTables() : [];
        sel.innerHTML = '<option value="">Current table</option>';
        for (const t of tables) {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            sel.appendChild(opt);
        }
    }

    async function updateColumns(tableName) {
        const sel = document.getElementById('search-column');
        if (!sel) return;
        sel.innerHTML = '<option value="">All columns</option>';

        if (!tableName) return;

        try {
            const schema = await App.apiJson(`/api/tables/${encodeURIComponent(tableName)}/schema`);
            for (const col of schema.columns) {
                const opt = document.createElement('option');
                opt.value = col.name;
                opt.textContent = col.name;
                sel.appendChild(opt);
            }
        } catch { /* ignore */ }
    }

    function doSearch() {
        if (sqlMode) return; // Don't text-search when in SQL mode

        const params = getParams();
        if (typeof DataGrid !== 'undefined') {
            DataGrid.fetchData(params.text ? params : null);
        }
        AppState.save({ search: params });
    }

    function getParams() {
        return {
            text: document.getElementById('search-input')?.value || '',
            regex: document.getElementById('search-regex')?.checked || false,
            table: document.getElementById('search-table')?.value || '',
            column: document.getElementById('search-column')?.value || '',
        };
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }
    const escHtml = esc;

    function isSqlMode() { return sqlMode; }

    // Wire up delete button (deferred — needs DOM)
    setTimeout(() => {
        document.getElementById('btn-sql-delete-query')?.addEventListener('click', deleteSavedQuery);
        document.getElementById('sql-saved-select')?.addEventListener('change', updateDeleteBtn);
    }, 0);

    return { init, getParams, updateColumns, populateTables, doSearch, toggleSqlMode, isSqlMode };
})();
