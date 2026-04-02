
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'database', 'app.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database at', dbPath);
        db.serialize(() => {
            // 1. Users Table
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    full_name TEXT,
                    password_hash TEXT NOT NULL,
                    auth_method TEXT,
                    profile_picture TEXT,
                    account_type TEXT DEFAULT 'user',
                    created_at TEXT NOT NULL,
                    last_login_at TEXT,
                    login_count INTEGER DEFAULT 0
                )
            `);

            // 2. Profile Analysis Table
            db.run(`
                CREATE TABLE IF NOT EXISTS profile_analysis (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    analyzed_username TEXT,
                    followers_count INTEGER,
                    following_count INTEGER,
                    ratio REAL,
                    total_posts INTEGER,
                    engagement_rate REAL,
                    account_age_days INTEGER,
                    is_private BOOLEAN,
                    suspicious_indicator_flag BOOLEAN,
                    anomaly_score REAL,
                    heuristics TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            `);
            // ensure new columns exist if table was created earlier
            db.all(`PRAGMA table_info(profile_analysis)`, [], (err, rows) => {
                if (err) {
                    console.error('Error reading profile_analysis table info', err.message);
                } else if (rows && rows.length) {
                    const cols = rows.map(r => r.name);
                    if (!cols.includes('anomaly_score')) {
                        db.run(`ALTER TABLE profile_analysis ADD COLUMN anomaly_score REAL`);
                    }
                    if (!cols.includes('heuristics')) {
                        db.run(`ALTER TABLE profile_analysis ADD COLUMN heuristics TEXT`);
                    }
                    if (!cols.includes('analyzed_username')) {
                        db.run(`ALTER TABLE profile_analysis ADD COLUMN analyzed_username TEXT`);
                    }
                }
            });

            // 3. Message Analysis Table
            db.run(`
                CREATE TABLE IF NOT EXISTS message_analysis (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    total_messages INTEGER,
                    spam_count INTEGER,
                    scam_count INTEGER,
                    suspicious_keyword_count INTEGER,
                    threat_score REAL,
                    heuristics TEXT,
                    last_analyzed_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            `);
            db.all(`PRAGMA table_info(message_analysis)`, [], (err, rows) => {
                if (err) {
                    console.error('Error reading message_analysis table info', err.message);
                } else if (rows && rows.length) {
                    const cols = rows.map(r => r.name);
                    if (!cols.includes('heuristics')) {
                        db.run(`ALTER TABLE message_analysis ADD COLUMN heuristics TEXT`);
                    }
                }
            });

            // 4. Behavior Analysis Table
            db.run(`
                CREATE TABLE IF NOT EXISTS behavior_analysis (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    posting_pattern TEXT,
                    follower_growth_spike BOOLEAN,
                    repeated_message_pattern_count INTEGER,
                    unusual_activity_timing_flag BOOLEAN,
                    anomaly_score REAL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            `);

            // 5. Final Predictions Table
            db.run(`
                CREATE TABLE IF NOT EXISTS final_predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    risk_score REAL,
                    risk_level TEXT,
                    confidence_score REAL,
                    profile_score REAL,
                    message_score REAL,
                    behavior_score REAL,
                    engagement_score REAL,
                    explanation_summary TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            `);
            console.log('All tables created or already exist.');

            // Insert a default admin user if it doesn't exist
            const adminEmail = 'admin@gmail.com';
            const adminPassword = '123456';
            const adminFullName = 'Admin User';
            const adminUsername = 'admin';

            db.get('SELECT * FROM users WHERE email = ?', [adminEmail], (err, row) => {
                if (err) {
                    console.error('Error checking for admin user', err.message);
                    return;
                }
                if (!row) {
                    bcrypt.hash(adminPassword, 10, (err, hash) => {
                        if (err) {
                            console.error('Error hashing admin password', err.message);
                            return;
                        }
                        db.run(`
                            INSERT INTO users (username, email, full_name, password_hash, account_type, created_at)
                            VALUES (?, ?, ?, ?, 'admin', datetime('now'))
                        `, [adminUsername, adminEmail, adminFullName, hash], (err) => {
                            if (err) {
                                console.error('Error inserting admin user', err.message);
                            } else {
                                console.log('Default admin user created.');
                            }
                        });
                    });
                }
            });
        });
    }
});

module.exports = db;
