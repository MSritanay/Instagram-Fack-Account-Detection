import sqlite3
import os
import json

DB_FILE = os.path.join(os.path.dirname(__file__), 'INSTAGRAM_AUTHENTICATION.db')

def init_db():
    """Initializes the database and creates tables if they don't exist."""
    print("Initializing database...")
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # Profile analysis table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profile_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                prediction TEXT,
                risk_score REAL,
                model_used TEXT,
                heuristics TEXT,
                analysis_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # ensure heuristics column exists for older installations
        cursor.execute("PRAGMA table_info(profile_analysis)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'heuristics' not in cols:
            cursor.execute('ALTER TABLE profile_analysis ADD COLUMN heuristics TEXT')

        # Message analysis table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS message_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_content TEXT NOT NULL,
                prediction TEXT,
                risk_score REAL,
                model_used TEXT,
                heuristics TEXT,
                analysis_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # ensure heuristics column exists
        cursor.execute("PRAGMA table_info(message_analysis)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'heuristics' not in cols:
            cursor.execute('ALTER TABLE message_analysis ADD COLUMN heuristics TEXT')

        conn.commit()
        conn.close()
        print("Database initialized successfully.")
    except sqlite3.Error as e:
        print(f"Database initialization error: {e}")

def store_profile_analysis(username, prediction, risk_score, model_used, heuristics=None):
    """Stores the result of a profile analysis in the database.  Heuristics may be logged as JSON text if provided."""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        if heuristics is not None:
            cursor.execute('''
                INSERT INTO profile_analysis (username, prediction, risk_score, model_used, heuristics)
                VALUES (?, ?, ?, ?, ?)
            ''', (username, prediction, risk_score, model_used, json.dumps(heuristics)))
        else:
            cursor.execute('''
                INSERT INTO profile_analysis (username, prediction, risk_score, model_used)
                VALUES (?, ?, ?, ?)
            ''', (username, prediction, risk_score, model_used))
        conn.commit()
        conn.close()
        print(f"Stored profile analysis for {username}.")
    except sqlite3.Error as e:
        print(f"Error storing profile analysis: {e}")

def store_message_analysis(message_content, prediction, risk_score, model_used, heuristics=None):
    """Stores the result of a message analysis in the database. Heuristics may be added as JSON text."""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        if heuristics is not None:
            cursor.execute('''
                INSERT INTO message_analysis (message_content, prediction, risk_score, model_used, heuristics)
                VALUES (?, ?, ?, ?, ?)
            ''', (message_content, prediction, risk_score, model_used, json.dumps(heuristics)))
        else:
            cursor.execute('''
                INSERT INTO message_analysis (message_content, prediction, risk_score, model_used)
                VALUES (?, ?, ?, ?)
            ''', (message_content, prediction, risk_score, model_used))
        conn.commit()
        conn.close()
        print(f"Stored message analysis.")
    except sqlite3.Error as e:
        print(f"Error storing message analysis: {e}")

def get_all_profile_analyses():
    """Retrieves all profile analysis records from the database."""
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM profile_analysis ORDER BY analysis_timestamp DESC')
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except sqlite3.Error as e:
        print(f"Error fetching profile analyses: {e}")
        return []

def get_all_message_analyses():
    """Retrieves all message analysis records from the database."""
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM message_analysis ORDER BY analysis_timestamp DESC')
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except sqlite3.Error as e:
        print(f"Error fetching message analyses: {e}")
        return []

if __name__ == '__main__':
    # This allows running the script directly to initialize the database
    init_db()
