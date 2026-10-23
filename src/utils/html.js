// Escapes text before it is put into innerHTML.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/[&<>"']/g, ch => MAP[ch]);
}
