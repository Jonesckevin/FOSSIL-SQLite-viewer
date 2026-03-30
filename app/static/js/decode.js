/* ═══════════════ DECODE.JS — Timestamp/Base64/Hex decode UI ═══════════════ */

const Decode = (() => {
    const esc = TableTree.escHtml;

    function open(value, colName) {
        const modal = document.getElementById('decodeModal');
        if (!modal) return;

        modal.querySelector('.modal-title').textContent = `Decode — ${colName}`;
        const input = document.getElementById('decode-input');
        if (input) input.value = String(value ?? '');

        const resultsDiv = document.getElementById('decode-results');
        resultsDiv.innerHTML = '<span class="text-muted">Decoding…</span>';

        // Run all decode types and combine results
        const parts = [];

        // Timestamp decode for numeric values
        const num = parseFloat(value);
        const str = String(value ?? '');

        Promise.allSettled([
            !isNaN(num) ? decodeTimestampToHtml(num) : Promise.resolve(null),
            (str.length >= 4 && /^[A-Za-z0-9+/=]+$/.test(str)) ? decodeBase64ToHtml(str) : Promise.resolve(null),
            (() => { const hexClean = str.replace(/[\s0x]/g, ''); return (hexClean.length >= 2 && /^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0) ? decodeHexToHtml(str) : Promise.resolve(null); })(),
        ]).then(results => {
            let html = '';
            const [tsResult, b64Result, hexResult] = results;
            if (tsResult.value) html += '<h6 class="small fw-semibold mt-2">Timestamps</h6>' + tsResult.value;
            else html += '<div class="text-muted small">Not a numeric value for timestamp</div>';
            if (b64Result.value) html += '<h6 class="small fw-semibold mt-2">Base64</h6>' + b64Result.value;
            if (hexResult.value) html += '<h6 class="small fw-semibold mt-2">Hex</h6>' + hexResult.value;
            resultsDiv.innerHTML = html || '<span class="text-muted">No decodings available</span>';
        });

        new bootstrap.Modal(modal).show();
    }

    async function decodeTimestampToHtml(value) {
        try {
            const data = await App.apiJson('/api/decode/timestamp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
            if (data.results.length === 0) return null;
            return data.results.map(r =>
                `<div class="decode-result-item"><div class="decode-result-label">${esc(r.format)}</div><div>${esc(r.value)}</div></div>`
            ).join('');
        } catch { return null; }
    }

    async function decodeBase64ToHtml(value) {
        try {
            const data = await App.apiJson('/api/decode/base64', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
            if (!data.success) return null;
            let html = `<div class="decode-result-item"><div class="decode-result-label">Size</div><div>${data.size} bytes</div></div>`;
            if (data.text) html += `<div class="decode-result-item"><div class="decode-result-label">Text</div><div style="white-space:pre-wrap">${esc(data.text)}</div></div>`;
            if (data.hex) html += `<div class="decode-result-item"><div class="decode-result-label">Hex</div><div style="font-family:monospace;font-size:11px;word-break:break-all">${esc(data.hex)}</div></div>`;
            return html;
        } catch { return null; }
    }

    async function decodeHexToHtml(value) {
        try {
            const data = await App.apiJson('/api/decode/hex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
            if (!data.success) return null;
            let html = `<div class="decode-result-item"><div class="decode-result-label">Size</div><div>${data.size} bytes</div></div>`;
            if (data.text) html += `<div class="decode-result-item"><div class="decode-result-label">Text</div><div style="white-space:pre-wrap">${esc(data.text)}</div></div>`;
            return html;
        } catch { return null; }
    }

    // Inline decode for row detail — shows top-2 most likely timestamps
    async function inlineDecode(value, container) {
        try {
            const data = await App.apiJson('/api/decode/timestamp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
            if (data.results.length === 0) return;

            const top = data.results.slice(0, 2);
            let html = top.map(r =>
                `<span class="badge bg-secondary-subtle text-secondary-emphasis me-1" title="${esc(r.format)}" style="cursor:pointer;font-weight:normal;font-size:10px">${esc(r.value)}</span>`
            ).join('');
            container.innerHTML = html;

            // Click any badge to open full decode modal
            container.querySelectorAll('.badge').forEach(b => {
                b.addEventListener('click', () => open(value, container.dataset.col || ''));
            });
        } catch { /* ignore */ }
    }

    return { open, inlineDecode };
})();
