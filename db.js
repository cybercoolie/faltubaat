// ============================================
// DATABASE SETUP - SQLite with better-sqlite3
// ============================================

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

// Database file path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'faltubaat.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
const db = new Database(DB_PATH);

// Enable foreign keys and WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================
// CREATE TABLES
// ============================================

const initDatabase = () => {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            first_name TEXT DEFAULT '',
            last_name TEXT DEFAULT '',
            gender TEXT CHECK(gender IN ('male', 'female', 'other')) NOT NULL,
            about TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active INTEGER DEFAULT 1
        )
    `);

    // Add first_name and last_name columns if they don't exist (migration)
    try {
        db.exec(`ALTER TABLE users ADD COLUMN first_name TEXT DEFAULT ''`);
    } catch (e) { /* Column already exists */ }
    try {
        db.exec(`ALTER TABLE users ADD COLUMN last_name TEXT DEFAULT ''`);
    } catch (e) { /* Column already exists */ }

    // Create index on username for faster lookups
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `);

    console.log('✅ Database initialized successfully');
};

// ============================================
// USER OPERATIONS
// ============================================

// Create a new user
const createUser = (username, password, gender, about = '', firstName = '', lastName = '') => {
    const hashedPassword = bcrypt.hashSync(password, 10);
    // Normalize username to lowercase for case-insensitive matching
    const normalizedUsername = username.toLowerCase();
    
    try {
        const stmt = db.prepare(`
            INSERT INTO users (username, password, gender, about, first_name, last_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(normalizedUsername, hashedPassword, gender, about, firstName, lastName);
        return { success: true, userId: result.lastInsertRowid };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { success: false, error: 'Username already exists' };
        }
        return { success: false, error: error.message };
    }
};

// Find user by username (case-insensitive)
const findUserByUsername = (username) => {
    const normalizedUsername = username.toLowerCase();
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
    return stmt.get(normalizedUsername);
};

// Find user by ID
const findUserById = (id) => {
    const stmt = db.prepare('SELECT id, username, first_name, last_name, gender, about, created_at, last_login FROM users WHERE id = ? AND is_active = 1');
    return stmt.get(id);
};

// Find user by ID with password (for password verification)
const findUserByIdWithPassword = (id) => {
    const stmt = db.prepare('SELECT id, username, password, first_name, last_name, gender, about, created_at, last_login FROM users WHERE id = ? AND is_active = 1');
    return stmt.get(id);
};

// Verify password
const verifyPassword = (password, hashedPassword) => {
    return bcrypt.compareSync(password, hashedPassword);
};

// Update last login
const updateLastLogin = (userId) => {
    const stmt = db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(userId);
};

// Update user profile
const updateUserProfile = (userId, updates) => {
    const allowedFields = ['about', 'gender', 'first_name', 'last_name'];
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }
    
    if (fields.length === 0) {
        return { success: false, error: 'No valid fields to update' };
    }
    
    values.push(userId);
    const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return { success: true };
};

// Change password
const changePassword = (userId, newPassword) => {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const stmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
    stmt.run(hashedPassword, userId);
    return { success: true };
};

// Update username
const updateUsername = (userId, newUsername) => {
    try {
        const stmt = db.prepare('UPDATE users SET username = ? WHERE id = ?');
        stmt.run(newUsername.toLowerCase(), userId);
        return { success: true };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { success: false, error: 'Username already taken' };
        }
        return { success: false, error: 'Failed to update username' };
    }
};

// Update password (alias for changePassword, used by server)
const updatePassword = (userId, newPassword) => {
    return changePassword(userId, newPassword);
};

// Delete user
const deleteUser = (userId) => {
    try {
        const stmt = db.prepare('DELETE FROM users WHERE id = ?');
        const result = stmt.run(userId);
        if (result.changes === 0) {
            return { success: false, error: 'User not found' };
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Failed to delete user' };
    }
};

// Get user count
const getUserCount = () => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
    return stmt.get().count;
};

// ============================================
// INITIALIZATION CHECK
// ============================================

// Run initialization if called directly
if (require.main === module) {
    console.log('🗄️  Initializing FaltuBaat Database...');
    console.log(`📁 Database path: ${DB_PATH}`);
    initDatabase();
    console.log(`👥 Total users: ${getUserCount()}`);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    db,
    initDatabase,
    createUser,
    findUserByUsername,
    findUserById,
    findUserByIdWithPassword,
    verifyPassword,
    updateLastLogin,
    updateUserProfile,
    changePassword,
    updateUsername,
    updatePassword,
    deleteUser,
    getUserCount
};
