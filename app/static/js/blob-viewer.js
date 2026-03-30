/* ═══════════════ BLOB-VIEWER.JS — Hex/Text/Image BLOB modal ═══════════════ */

const BlobViewer = (() => {
    let currentData = null;
    let zoomLevel = 1;

    async function open(table, rowid, column) {
        const url = `/api/tables/${encodeURIComponent(table)}/rows/${rowid}/blob/${encodeURIComponent(column)}`;

        try {
            const resp = await App.api(url);
            const blob = await resp.blob();
            currentData = { blob, table, rowid, column, contentType: resp.headers.get('content-type') || '' };

            const arrayBuf = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);

            renderHex(bytes);
            renderText(bytes);
            renderImage(blob);

            document.querySelector('#blobModal .modal-title').textContent = `BLOB — ${column} (${App.formatBytes(bytes.length)})`;
            const blobInfo = document.getElementById('blob-info');
            if (blobInfo) blobInfo.textContent = `${currentData.contentType || 'unknown'} · ${App.formatBytes(bytes.length)}`;

            const modal = new bootstrap.Modal(document.getElementById('blobModal'));
            modal.show();

            // Activate hex tab by default
            const hexTab = document.querySelector('#blobModal .nav-link[data-bs-target="#blob-pane-hex"]');
            if (hexTab) bootstrap.Tab.getOrCreateInstance(hexTab).show();
        } catch {
            App.toast('Failed to load BLOB', 'danger');
        }
    }

    function renderHex(bytes) {
        const el = document.getElementById('blob-hex-content');
        if (!el) return;

        const maxBytes = 16 * 1024; // 16 KB
        const view = bytes.slice(0, maxBytes);
        const lines = [];

        for (let i = 0; i < view.length; i += 16) {
            const offset = i.toString(16).padStart(8, '0');
            const hexParts = [];
            const asciiParts = [];

            for (let j = 0; j < 16; j++) {
                if (i + j < view.length) {
                    const b = view[i + j];
                    hexParts.push(b.toString(16).padStart(2, '0'));
                    asciiParts.push(b >= 32 && b <= 126 ? String.fromCharCode(b) : '.');
                } else {
                    hexParts.push('  ');
                    asciiParts.push(' ');
                }
            }

            const hex = hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ');
            lines.push(`${offset}  ${hex}  |${asciiParts.join('')}|`);
        }

        if (bytes.length > maxBytes) {
            lines.push(`\n... truncated at ${App.formatBytes(maxBytes)} of ${App.formatBytes(bytes.length)}`);
        }

        el.textContent = lines.join('\n');
    }

    function renderText(bytes) {
        const el = document.getElementById('blob-text-content');
        if (!el) return;

        const maxBytes = 64 * 1024;
        const view = bytes.slice(0, maxBytes);
        try {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(view);
            el.textContent = text;
            if (bytes.length > maxBytes) {
                el.textContent += `\n\n... truncated at ${App.formatBytes(maxBytes)}`;
            }
        } catch {
            el.textContent = '[Unable to decode as UTF-8]';
        }
    }

    function renderImage(blob) {
        const container = document.getElementById('blob-pane-image');
        const img = document.getElementById('blob-image-preview');
        if (!img || !container) return;

        const isImage = currentData?.contentType?.startsWith('image/');

        if (isImage) {
            const objUrl = URL.createObjectURL(blob);
            img.onload = () => URL.revokeObjectURL(objUrl);
            img.src = objUrl;
            img.classList.remove('d-none');
        } else {
            img.classList.add('d-none');
            img.src = '';
        }
    }

    function initZoomControls() {
        document.querySelectorAll('.blob-zoom').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.zoom;
                if (action === 'fit') {
                    zoomLevel = 1;
                    applyZoom();
                } else if (action === '100') {
                    zoomLevel = 1;
                    const img = document.getElementById('blob-image-preview');
                    if (img) { img.style.transform = 'none'; img.style.maxWidth = 'none'; }
                } else if (action === 'in') {
                    zoomLevel = Math.min(5, zoomLevel * 1.25);
                    applyZoom();
                } else if (action === 'out') {
                    zoomLevel = Math.max(0.1, zoomLevel / 1.25);
                    applyZoom();
                }
            });
        });

        // Mousewheel zoom on image
        document.getElementById('blob-image-preview')?.addEventListener('wheel', e => {
            e.preventDefault();
            if (e.deltaY < 0) zoomLevel = Math.min(5, zoomLevel * 1.1);
            else zoomLevel = Math.max(0.1, zoomLevel / 1.1);
            applyZoom();
        });
    }

    function applyZoom() {
        const img = document.getElementById('blob-image-preview');
        if (img) {
            img.style.transform = `scale(${zoomLevel})`;
            img.style.maxWidth = zoomLevel <= 1 ? '100%' : 'none';
        }
    }

    // Save BLOB to file
    function initSaveButton() {
        document.getElementById('btn-blob-save')?.addEventListener('click', () => {
            if (!currentData) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(currentData.blob);
            // Detect extension from content type or use default
            const ext = currentData.contentType?.includes('image/jpeg') ? '.jpg'
                : currentData.contentType?.includes('image/png') ? '.png'
                : currentData.contentType?.includes('image/gif') ? '.gif'
                : currentData.contentType?.includes('image/webp') ? '.webp'
                : currentData.contentType?.includes('application/pdf') ? '.pdf'
                : '.bin';
            a.download = `${currentData.column}_row${currentData.rowid}${ext}`;
            a.click();
            URL.revokeObjectURL(a.href);
            App.toast('BLOB saved', 'success');
        });
    }

    // Copy hex
    function initCopyButtons() {
        document.getElementById('btn-copy-hex-raw')?.addEventListener('click', () => {
            const el = document.getElementById('blob-hex-content');
            if (el) {
                ContextMenu.copyText(el.textContent);
                App.toast('Hex copied', 'success');
            }
        });
        document.getElementById('btn-copy-hex-fmt')?.addEventListener('click', () => {
            if (!currentData) return;
            currentData.blob.arrayBuffer().then(buf => {
                const bytes = new Uint8Array(buf);
                const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
                ContextMenu.copyText(hex);
                App.toast('Formatted hex copied', 'success');
            });
        });
        document.getElementById('btn-copy-hex-b64')?.addEventListener('click', () => {
            if (!currentData) return;
            currentData.blob.arrayBuffer().then(buf => {
                const bytes = new Uint8Array(buf);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                ContextMenu.copyText(btoa(binary));
                App.toast('Base64 copied', 'success');
            });
        });
    }

    function init() {
        initZoomControls();
        initSaveButton();
        initCopyButtons();
    }

    return { init, open };
})();
