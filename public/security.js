// ============================================
// SECURITY UTILITIES
// Simple XSS prevention without external dependencies
// ============================================

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} - Escaped string safe for innerHTML
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Sanitize user input for display
 * Removes potential XSS vectors while preserving safe content
 * @param {string} str - The string to sanitize
 * @param {number} maxLength - Maximum length (default 1000)
 * @returns {string} - Sanitized string
 */
function sanitizeInput(str, maxLength = 1000) {
    if (typeof str !== 'string') return '';
    return escapeHtml(str.slice(0, maxLength));
}

/**
 * Sanitize username for display
 * @param {string} username - The username to sanitize
 * @returns {string} - Sanitized username
 */
function sanitizeUsername(username) {
    return sanitizeInput(username, 50);
}

/**
 * Sanitize chat message for display
 * @param {string} message - The message to sanitize
 * @returns {string} - Sanitized message
 */
function sanitizeMessage(message) {
    return sanitizeInput(message, 2000);
}

// Make functions globally available
window.escapeHtml = escapeHtml;
window.sanitizeInput = sanitizeInput;
window.sanitizeUsername = sanitizeUsername;
window.sanitizeMessage = sanitizeMessage;
