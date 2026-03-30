/* ═══════════════ TABLE-TREE.JS — Left sidebar table tree ═══════════════ */

const TableTree = (() => {
    let tables = [];
    let activeTable = null;

    async function load() {
        const container = document.getElementById('table-tree');
        if (!container) return;

        try {
            const data = await App.apiJson('/api/tables');
            tables = data.tables;
            render();
            // Restore selected table from state
            try {
                const state = await App.apiJson('/api/state');
                if (state.selected_table) {
                    const t = tables.find(t => t.name === state.selected_table);
                    if (t) select(t.name);
                }
            } catch {}
        } catch {
            container.innerHTML = '<div class="p-3 text-muted">Failed to load tables</div>';
        }
    }

    function render() {
        const container = document.getElementById('table-tree');
        if (!container) return;

        if (!tables.length) {
            container.innerHTML = '<div class="p-3 text-muted">No tables found</div>';
            return;
        }

        let html = '';
        for (const t of tables) {
            const active = t.name === activeTable ? ' active' : '';
            const count = t.row_count >= 0 ? t.row_count.toLocaleString() : '?';
            html += `<div class="tree-item${active}" data-table="${escHtml(t.name)}" title="${escHtml(t.name)} (${count} rows)">
                <i class="bi bi-chevron-right tree-expand" style="font-size:10px;transition:transform .15s"></i>
                <i class="bi bi-table" style="font-size:12px"></i>
                <span class="text-truncate">${escHtml(t.name)}</span>
                <span class="row-count">${count}</span>
            </div>
            <div class="tree-columns" data-columns-for="${escHtml(t.name)}"></div>`;
        }
        container.innerHTML = html;

        // Bind clicks
        container.querySelectorAll('.tree-item').forEach(el => {
            el.addEventListener('click', async e => {
                const name = el.dataset.table;
                if (e.target.closest('.tree-expand')) {
                    await toggleExpand(el, name);
                } else {
                    await select(name);
                }
            });
        });
    }

    async function toggleExpand(el, name) {
        const colDiv = document.querySelector(`.tree-columns[data-columns-for="${CSS.escape(name)}"]`);
        if (!colDiv) return;

        if (el.classList.contains('expanded')) {
            el.classList.remove('expanded');
            el.querySelector('.tree-expand').style.transform = '';
            colDiv.style.display = 'none';
            return;
        }

        // Load schema if not loaded yet
        if (!colDiv.innerHTML) {
            try {
                const schema = await App.apiJson(`/api/tables/${encodeURIComponent(name)}/schema`);
                let html = '';
                for (const c of schema.columns) {
                    const pk = c.pk ? ' <i class="bi bi-key" style="font-size:9px;color:var(--accent)" title="Primary Key"></i>' : '';
                    html += `<div class="tree-col-item"><span>${escHtml(c.name)}${pk}</span><span class="col-type">${escHtml(c.type || 'ANY')}</span></div>`;
                }
                colDiv.innerHTML = html;
            } catch {
                colDiv.innerHTML = '<div class="p-1 text-muted" style="font-size:11px">Error loading schema</div>';
            }
        }

        el.classList.add('expanded');
        el.querySelector('.tree-expand').style.transform = 'rotate(90deg)';
        colDiv.style.display = 'block';
    }

    async function select(name) {
        if (activeTable === name) return;
        activeTable = name;

        document.querySelectorAll('.tree-item').forEach(el => {
            el.classList.toggle('active', el.dataset.table === name);
        });

        AppState.save({ selected_table: name });

        // Load data into grid
        if (typeof DataGrid !== 'undefined') {
            DataGrid.loadTable(name);
        }
        // Update search dropdowns
        if (typeof Search !== 'undefined') {
            Search.updateColumns(name);
        }
    }

    function clear() {
        tables = [];
        activeTable = null;
        const container = document.getElementById('table-tree');
        if (container) container.innerHTML = '<div class="p-3 text-muted">No database open</div>';
    }

    function getActive() { return activeTable; }
    function getTables() { return tables; }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    return { load, clear, select, getActive, getTables, escHtml };
})();
