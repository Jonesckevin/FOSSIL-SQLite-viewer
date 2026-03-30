/* ═══════════════ THEME: System-adaptive + manual toggle ═══════════════ */
const Theme = (() => {
    const KEY = 'sqlite-analyzer-theme';
    const html = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    function apply(theme) {
        html.setAttribute('data-bs-theme', theme);
        const btn = document.getElementById('btn-theme');
        if (btn) {
            btn.innerHTML = theme === 'dark'
                ? '<i class="bi bi-sun"></i>'
                : '<i class="bi bi-moon-stars"></i>';
            btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
        }
    }

    function current() {
        return html.getAttribute('data-bs-theme') || 'light';
    }

    function init() {
        const saved = localStorage.getItem(KEY);
        if (saved) {
            apply(saved);
        } else {
            apply(mq.matches ? 'dark' : 'light');
        }
        mq.addEventListener('change', e => {
            if (!localStorage.getItem(KEY)) {
                apply(e.matches ? 'dark' : 'light');
            }
        });
        const btn = document.getElementById('btn-theme');
        if (btn) {
            btn.addEventListener('click', () => {
                const next = current() === 'dark' ? 'light' : 'dark';
                localStorage.setItem(KEY, next);
                apply(next);
                AppState.save({ theme: next });
            });
        }
    }

    function reset() {
        localStorage.removeItem(KEY);
        apply(mq.matches ? 'dark' : 'light');
    }

    return { init, current, reset, apply };
})();
