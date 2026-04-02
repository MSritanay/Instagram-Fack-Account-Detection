const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 5000;
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? '' : 'dev-only-jwt-secret-change-me-32chars');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}
if (!process.env.JWT_SECRET && !isProduction) {
    console.warn('[SECURITY] Using development JWT secret fallback. Set JWT_SECRET to remove this warning.');
}

// Middleware
app.disable('x-powered-by');

const defaultCorsOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
];
const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const corsAllowlist = new Set(
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins
);

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser clients and extension requests.
        if (!origin) return callback(null, true);
        if (origin.startsWith('chrome-extension://')) return callback(null, true);
        if (corsAllowlist.has(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
}));
app.use(bodyParser.json());

function extractErrorLocation(error) {
    const stack = String(error?.stack || '');
    if (!stack) return 'unknown-location';
    const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
    const target = lines.find((line) => line.startsWith('at ')) || lines[0] || '';
    return target.replace(/^at\s+/, '') || 'unknown-location';
}

function logError(context, error, meta = {}) {
    const payload = {
        timestamp: new Date().toISOString(),
        context,
        message: String(error?.message || error || 'Unknown error'),
        location: extractErrorLocation(error),
        meta,
    };
    console.error('[ERROR]', JSON.stringify(payload));
}

app.use((req, res, next) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
});

const performanceMetrics = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
    totalDurationMs: 0,
    recentDurations: [],
    lastRequestAt: null,
};
const PERF_SAMPLE_LIMIT = 200;

function recordPerformance(durationMs, statusCode) {
    performanceMetrics.totalRequests += 1;
    performanceMetrics.totalDurationMs += durationMs;
    performanceMetrics.lastRequestAt = new Date().toISOString();
    if (statusCode >= 500) {
        performanceMetrics.totalErrors += 1;
    }
    performanceMetrics.recentDurations.push(durationMs);
    if (performanceMetrics.recentDurations.length > PERF_SAMPLE_LIMIT) {
        performanceMetrics.recentDurations.shift();
    }
}

function getPerformanceSnapshot() {
    const uptimeSeconds = Math.floor((Date.now() - performanceMetrics.startedAt) / 1000);
    const avgResponseMs = performanceMetrics.totalRequests > 0
        ? performanceMetrics.totalDurationMs / performanceMetrics.totalRequests
        : 0;
    const sorted = [...performanceMetrics.recentDurations].sort((a, b) => a - b);
    const p95Index = sorted.length > 0 ? Math.floor(0.95 * (sorted.length - 1)) : 0;
    const p95ResponseMs = sorted.length > 0 ? sorted[p95Index] : 0;
    const errorRate = performanceMetrics.totalRequests > 0
        ? performanceMetrics.totalErrors / performanceMetrics.totalRequests
        : 0;
    const memory = process.memoryUsage();
    return {
        uptimeSeconds,
        totalRequests: performanceMetrics.totalRequests,
        totalErrors: performanceMetrics.totalErrors,
        errorRate,
        avgResponseMs,
        p95ResponseMs,
        lastRequestAt: performanceMetrics.lastRequestAt,
        memoryUsage: {
            rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
            heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
            heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10,
        },
    };
}

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        recordPerformance(Date.now() - start, res.statusCode || 0);
    });
    next();
});

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // API serves JSON only; disallow embedding/external script execution surfaces.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

process.on('unhandledRejection', (reason) => {
    logError('process.unhandledRejection', reason, {});
});

process.on('uncaughtException', (error) => {
    logError('process.uncaughtException', error, {});
});

const requestBuckets = new Map();
function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.connection?.remoteAddress || 'unknown';
}

function consumeRateLimit(bucketKey, key, limit, windowMs) {
    const now = Date.now();
    const composedKey = `${bucketKey}:${key}`;
    const current = requestBuckets.get(composedKey);
    if (!current || now > current.resetAt) {
        requestBuckets.set(composedKey, { count: 1, resetAt: now + windowMs });
        return { limited: false, remaining: limit - 1, retryAfterSec: 0 };
    }
    current.count += 1;
    requestBuckets.set(composedKey, current);
    if (current.count > limit) {
        return {
            limited: true,
            remaining: 0,
            retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
    }
    return { limited: false, remaining: Math.max(0, limit - current.count), retryAfterSec: 0 };
}

app.use('/api', (req, res, next) => {
    const ip = getClientIp(req);
    const limitState = consumeRateLimit('api', ip, 300, 5 * 60 * 1000);
    if (limitState.limited) {
        res.setHeader('Retry-After', String(limitState.retryAfterSec));
        return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }
    next();
});

const loginThrottleState = new Map();
function getLoginThrottleKey(req, username, routePrefix = 'user') {
    return `${routePrefix}:${String(username || '').trim().toLowerCase()}:${getClientIp(req)}`;
}
function registerLoginFailure(key) {
    const now = Date.now();
    const current = loginThrottleState.get(key) || { failures: 0, blockedUntil: 0, updatedAt: now };
    current.failures += 1;
    current.updatedAt = now;
    if (current.failures >= 7) {
        current.blockedUntil = now + (15 * 60 * 1000);
    } else if (current.failures >= 4) {
        current.blockedUntil = now + (2 * 60 * 1000);
    }
    loginThrottleState.set(key, current);
    return current;
}
function clearLoginFailures(key) {
    loginThrottleState.delete(key);
}
function checkLoginThrottle(key) {
    const now = Date.now();
    const current = loginThrottleState.get(key);
    if (!current) return { blocked: false, retryAfterSec: 0 };
    if (current.blockedUntil > now) {
        return {
            blocked: true,
            retryAfterSec: Math.max(1, Math.ceil((current.blockedUntil - now) / 1000)),
        };
    }
    if (now - current.updatedAt > 30 * 60 * 1000) {
        loginThrottleState.delete(key);
    }
    return { blocked: false, retryAfterSec: 0 };
}

function isAdminAccount(user) {
    const role = user?.account_type || user?.accountType || '';
    return String(role).toLowerCase() === 'admin';
}

// --- AUTHENTICATION ENDPOINTS ---

// User Signup
app.post('/api/signup', async (req, res) => {
    const { email, fullName, username, password } = req.body;

    if (!username || !password || !email || !fullName) {
        return res.status(400).json({ message: 'Email, full name, username, and password are required.' });
    }

    try {
        const password_hash = await bcrypt.hash(password, 10);
        const createdAt = new Date().toISOString();
        const insertSql = `
            INSERT INTO users (email, full_name, username, password_hash, auth_method, created_at)
            VALUES (?, ?, ?, ?, 'password', ?)
        `;

        db.run(insertSql, [email, fullName, username, password_hash, createdAt], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ message: 'Username or email already exists.' });
                }
                return res.status(500).json({ message: 'Failed to create user.', error: err.message });
            }
            res.status(201).json({ message: 'User created successfully', userId: this.lastID });
        });
    } catch (hashError) {
        res.status(500).json({ message: 'Failed to process request.', error: hashError.message });
    }
});

// User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const throttleKey = getLoginThrottleKey(req, username, 'user');
    const throttleState = checkLoginThrottle(throttleKey);
    if (throttleState.blocked) {
        res.setHeader('Retry-After', String(throttleState.retryAfterSec));
        return res.status(429).json({ message: 'Too many failed login attempts. Please try again later.' });
    }

    if (!username || !password) {
        registerLoginFailure(throttleKey);
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.', error: err.message });
        }
        if (!user) {
            registerLoginFailure(throttleKey);
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (match) {
            clearLoginFailures(throttleKey);
            const now = new Date().toISOString();
            const updateSql = `UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?`;
            db.run(updateSql, [now, user.id]);

            const token = jwt.sign(
                {
                    userId: user.id,
                    username: user.username,
                    accountType: user.account_type || 'user',
                    account_type: user.account_type || 'user',
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            // CRITICAL FIX: Return the user object along with the token
            const { password_hash, ...userResponse } = user;
            res.status(200).json({ message: 'Login successful', token, user: userResponse });
        } else {
            registerLoginFailure(throttleKey);
            res.status(401).json({ message: 'Invalid credentials.' });
        }
    });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const throttleKey = getLoginThrottleKey(req, username, 'admin');
    const throttleState = checkLoginThrottle(throttleKey);
    if (throttleState.blocked) {
        res.setHeader('Retry-After', String(throttleState.retryAfterSec));
        return res.status(429).json({ message: 'Too many failed admin login attempts. Please try again later.' });
    }

    if (!username || !password) {
        registerLoginFailure(throttleKey);
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Database error.', error: err.message });
        }
        if (!user || !isAdminAccount(user)) {
            registerLoginFailure(throttleKey);
            return res.status(403).json({ message: 'Admin access required.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            registerLoginFailure(throttleKey);
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        clearLoginFailures(throttleKey);

        const now = new Date().toISOString();
        const updateSql = `UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?`;
        db.run(updateSql, [now, user.id]);

        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username,
                accountType: user.account_type || 'admin',
                account_type: user.account_type || 'admin',
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.status(200).json({ message: 'Admin login successful', token });
    });
});


// --- JWT AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // if there isn't any token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // if the token is no longer valid
        req.user = user;
        next(); // move on to the next middleware
    });
};

const requireAdmin = (req, res, next) => {
    if (!isAdminAccount(req.user)) {
        return res.status(403).json({ message: 'Forbidden: admin role required.' });
    }
    next();
};

// --- ADMIN ENDPOINTS ---
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rows = await allDb(
            `SELECT id, username, email, full_name, account_type, created_at, last_login_at, login_count
             FROM users
             ORDER BY created_at DESC`
        );
        res.status(200).json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch users', error: err.message });
    }
});

app.get('/api/admin/analyses', authenticateToken, requireAdmin, async (req, res) => {
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow, 'fp.created_at');
    try {
        const rows = await allDb(
            `SELECT fp.*, u.username, u.email, u.account_type
             FROM final_predictions fp
             JOIN users u ON u.id = fp.user_id
             WHERE 1 = 1${timeFilter.clause}
             ORDER BY fp.created_at DESC
             LIMIT 200`
            ,
            [...timeFilter.params]
        );
        res.status(200).json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch analyses', error: err.message });
    }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow);
    try {
        const totalAnalysesSql = `SELECT COUNT(*) AS totalAnalyses FROM final_predictions WHERE 1 = 1${timeFilter.clause}`;
        const highRiskSql = `SELECT COUNT(*) AS highRiskCount FROM final_predictions WHERE risk_score >= 70${timeFilter.clause}`;
        const avgRiskSql = `SELECT COALESCE(AVG(risk_score), 0) AS avgRiskScore FROM final_predictions WHERE 1 = 1${timeFilter.clause}`;
        const [
            userCountRow,
            analysisCountRow,
            highRiskCountRow,
            avgRiskRow,
        ] = await Promise.all([
            getDb(`SELECT COUNT(*) AS totalUsers FROM users`),
            getDb(totalAnalysesSql, [...timeFilter.params]),
            getDb(highRiskSql, [...timeFilter.params]),
            getDb(avgRiskSql, [...timeFilter.params]),
        ]);

        res.status(200).json({
            totalUsers: Number(userCountRow?.totalUsers || 0),
            totalAnalyses: Number(analysisCountRow?.totalAnalyses || 0),
            highRiskCount: Number(highRiskCountRow?.highRiskCount || 0),
            avgRiskScore: Math.round(Number(avgRiskRow?.avgRiskScore || 0) * 100) / 100,
            selectedWindow,
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch stats', error: err.message });
    }
});

app.get('/api/admin/flags', authenticateToken, requireAdmin, async (req, res) => {
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow, 'fp.created_at');
    try {
        const rows = await allDb(
            `SELECT fp.id, fp.user_id, fp.risk_score, fp.risk_level, fp.confidence_score, fp.created_at, fp.explanation_summary,
                    u.username, u.email
             FROM final_predictions fp
             JOIN users u ON u.id = fp.user_id
             WHERE 1 = 1${timeFilter.clause}
             ORDER BY fp.created_at DESC
             LIMIT 250`,
            [...timeFilter.params]
        );

        const riskyTags = new Set([
            'scam',
            'bot',
            'spam',
            'suspicious-message',
            'abusive-harassment',
            'sexual-solicitation',
            'hacker-risk',
            'sextortion-blackmail',
            'violent-threat',
            'self-harm-risk',
        ]);

        const flagged = (Array.isArray(rows) ? rows : [])
            .map((row) => {
                const details = safeJsonParse(row.explanation_summary) || {};
                const contentType = String(details.contentType || '').toLowerCase();
                const flags = Array.isArray(details.flags) ? details.flags : [];
                const classificationTag = String(details.classificationTag || '').trim().toLowerCase();
                let contentSummary = null;
                if (contentType === 'message') {
                    const summary = extractMessageSummary(details.content);
                    contentSummary = summary.preview || summary.conversationName || null;
                } else if (contentType === 'profile') {
                    contentSummary = extractProfileTargetUsername(details.content);
                }
                const riskScore = Number(row.risk_score || 0);
                const riskLevel = String(row.risk_level || '').toLowerCase();
                const isFlagged = riskScore >= 70 ||
                    riskLevel === 'high' ||
                    flags.length > 0 ||
                    (classificationTag && riskyTags.has(classificationTag));
                return {
                    id: row.id,
                    user_id: row.user_id,
                    username: row.username,
                    email: row.email,
                    risk_score: riskScore,
                    risk_level: row.risk_level,
                    confidence_score: row.confidence_score,
                    created_at: row.created_at,
                    classificationTag: classificationTag || null,
                    flags,
                    contentType: contentType || null,
                    contentSummary,
                    isFlagged,
                };
            })
            .filter((item) => item.isFlagged);

        res.status(200).json(flagged);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch flagged analyses', error: err.message });
    }
});

app.get('/api/admin/performance', authenticateToken, requireAdmin, (req, res) => {
    res.status(200).json(getPerformanceSnapshot());
});

app.get('/api/admin/logs', authenticateToken, requireAdmin, (req, res) => {
    const limit = Math.min(500, Math.max(20, Number(req.query.limit || 150)));
    const logs = [
        readLogLines('server.log', limit),
        readLogLines('server.err.log', limit),
    ];
    res.status(200).json({ logs });
});


// --- DASHBOARD ENDPOINT ---

function detectAnomalies(history) {
    if (history.length < 5) {
        return [];
    }

    const anomalies = [];
    const windowSize = 5;

    for (let i = windowSize; i < history.length; i++) {
        const window = history.slice(i - windowSize, i);
        const scores = window.map(item => item.risk_score);
        const mean = scores.reduce((a, b) => a + b, 0) / windowSize;
        const stdDev = Math.sqrt(scores.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / windowSize);

        const currentScore = history[i].risk_score;
        if (Math.abs(currentScore - mean) > 2 * stdDev) {
            anomalies.push({
                date: history[i].created_at,
                score: currentScore,
                mean,
                stdDev,
            });
        }
    }

    return anomalies;
}

function extractProfileTargetUsername(rawContent) {
    const parsed = safeJsonParse(rawContent);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate =
        parsed.analyzedUsername ||
        parsed.username ||
        parsed.targetUsername ||
        parsed.handle ||
        null;
    const text = String(candidate || '').trim();
    return text || null;
}

function extractMessageSummary(rawContent) {
    const parsed = safeJsonParse(rawContent);
    if (parsed && typeof parsed === 'object') {
        const conversationName = String(parsed.conversationName || '').trim();
        const messageList = Array.isArray(parsed.messages)
            ? parsed.messages
            : (Array.isArray(parsed.rawMessages) ? parsed.rawMessages : []);
        const normalized = messageList
            .map((msg) => String(msg || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        if (normalized.length > 0) {
            return {
                preview: normalized[0].slice(0, 140),
                totalMessages: normalized.length,
                conversationName: conversationName || null,
            };
        }
        return { preview: null, totalMessages: 0, conversationName: conversationName || null };
    }
    const plainText = String(rawContent || '').replace(/\s+/g, ' ').trim();
    if (!plainText) {
        return { preview: null, totalMessages: 0, conversationName: null };
    }
    return {
        preview: plainText.slice(0, 140),
        totalMessages: 1,
        conversationName: null,
    };
}

function normalizeAccountHandle(value) {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeMessageTextForDetection(value) {
    const charMap = {
        '0': 'o',
        '1': 'i',
        '3': 'e',
        '4': 'a',
        '5': 's',
        '7': 't',
        '@': 'a',
        '$': 's',
    };
    let text = String(value || '').normalize('NFKC').toLowerCase();
    // Strip zero-width / directional characters used for simple obfuscation.
    text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '');
    text = text
        .replace(/hxxps?:\/\//g, 'https://')
        .replace(/\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+/g, '.')
        .replace(/\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+/g, '@');
    text = text.replace(/[013457@$]/g, (ch) => charMap[ch] || ch);
    text = text.replace(/[_\-\.\s]{2,}/g, ' ');
    return text.replace(/\s+/g, ' ').trim();
}

function deriveAccountVerdictFromAggregation(aggregate) {
    const weightedRisk = Number(aggregate?.weightedRisk || 0);
    const botEvidence = Number(aggregate?.botEvidence || 0);
    const scamEvidence = Number(aggregate?.scamEvidence || 0);
    const spamEvidence = Number(aggregate?.spamEvidence || 0);
    const humanEvidence = Math.max(0, Number(aggregate?.sampleSize || 0) - (scamEvidence + botEvidence + spamEvidence));
    const sampleSize = Number(aggregate?.sampleSize || 0);

    const distribution = {
        scam: scamEvidence,
        bot: botEvidence,
        spam: spamEvidence,
        human: humanEvidence,
    };
    const sorted = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const topCount = Number(sorted[0]?.[1] || 0);
    const secondCount = Number(sorted[1]?.[1] || 0);
    const topRatio = sampleSize > 0 ? (topCount / sampleSize) : 0;
    const ratioGap = sampleSize > 0 ? ((topCount - secondCount) / sampleSize) : 0;
    const mixedSignals = [scamEvidence > 0, botEvidence > 0, spamEvidence > 0].filter(Boolean).length;
    if (
        sampleSize >= 6 &&
        mixedSignals >= 2 &&
        topRatio <= 0.5 &&
        ratioGap <= 0.12 &&
        weightedRisk >= 35
    ) {
        return {
            finalLabel: 'mixed-risk',
            verdictMode: 'conflict-aware',
            distribution,
            mixed: true,
            mixedReason: 'Conflicting class evidence across recent analyses.',
        };
    }

    let finalLabel = 'human';
    if (scamEvidence >= 2 || weightedRisk >= 72) finalLabel = 'scam';
    else if (botEvidence >= 2 || (botEvidence >= 1 && weightedRisk >= 55)) finalLabel = 'bot';
    else if (spamEvidence >= 2 || weightedRisk >= 40) finalLabel = 'spam';
    return {
        finalLabel,
        verdictMode: 'deterministic',
        distribution,
        mixed: false,
        mixedReason: null,
    };
}

function safeDivide(numerator, denominator) {
    const n = Number(numerator || 0);
    const d = Number(denominator || 0);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
    return n / d;
}

function toPercentText(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function buildTopRiskReasons({ profileAnalysis, messageAnalysis, behaviorAnalysis, latestPredictionDetails }) {
    const reasons = [];
    const profileRisk = Number(profileAnalysis?.anomaly_score || 0);
    const messageRisk = Number(messageAnalysis?.threat_score || 0);
    const behavioralRisk = Number(behaviorAnalysis?.anomaly_score || 0);
    const classificationTag = String(latestPredictionDetails?.classificationTag || '').trim();

    if (messageRisk >= 70) {
        reasons.push(`High message threat detected (${toPercentText(messageRisk)}).`);
    } else if (messageRisk >= 40) {
        reasons.push(`Moderate message threat detected (${toPercentText(messageRisk)}).`);
    }

    if (profileRisk >= 70) {
        reasons.push(`Profile anomaly score is high (${toPercentText(profileRisk)}).`);
    } else if (profileRisk >= 40) {
        reasons.push(`Profile anomaly score is elevated (${toPercentText(profileRisk)}).`);
    }

    if (behavioralRisk >= 60) {
        reasons.push(`Behavioral anomaly patterns are elevated (${toPercentText(behavioralRisk)}).`);
    }

    const spamCount = Number(messageAnalysis?.spam_count || 0);
    const scamCount = Number(messageAnalysis?.scam_count || 0);
    if (scamCount > 0) reasons.push(`Scam indicators were detected in recent messages (${scamCount}).`);
    if (spamCount > 0) reasons.push(`Spam indicators were detected in recent messages (${spamCount}).`);

    const suspiciousFlag = Number(profileAnalysis?.suspicious_indicator_flag || 0);
    if (suspiciousFlag > 0) reasons.push('Profile suspicious-indicator flag was triggered.');

    if (classificationTag) {
        reasons.push(`Latest classification: ${classificationTag}.`);
    }

    const fallback = Array.isArray(latestPredictionDetails?.recommendations)
        ? latestPredictionDetails.recommendations.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    for (const item of fallback) {
        if (reasons.length >= 3) break;
        if (!reasons.includes(item)) reasons.push(item);
    }

    if (reasons.length === 0) {
        reasons.push('Not enough analysis evidence yet. Run additional profile/message scans.');
    }

    return reasons.slice(0, 3);
}

app.get('/api/dashboard', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow);
    let latestProfileRisk = 0;
    let latestMessageRisk = 0;
    let latestBehaviorRisk = 0;
    let latestPredictionDetails = {};
    const dashboardData = {
        // Provide defaults to prevent "Incomplete data" error
        identity: null,
        profileAnalysis: {},
        messageAnalysis: {},
        behaviorAnalysis: {},
        overallRisk: 0,
        recommendations: [],
        riskHistory: [],
        selectedWindow,
        riskDrivers: { profileRisk: 0, messageRisk: 0, behavioralRisk: 0 },
        riskDelta: { current: 0, previous: 0, delta: 0, direction: 'flat' },
        topRiskReasons: [],
        recentAnalyses: [],
        analysisContext: {
            profileTargetUsername: null,
            profileAnalyzedAt: null,
            messageTargetUsername: null,
            messagePreview: null,
            messageAnalyzedAt: null,
            messageTotalMessages: 0,
        },
    };

    const queries = [
        // 1. Get User Identity
        new Promise((resolve, reject) => {
            db.get(`SELECT id, username, email, full_name, profile_picture, account_type, created_at, last_login_at FROM users WHERE id = ?`, [userId], (err, row) => {
                if (err) return reject(err);
                dashboardData.identity = row || {
                    id: userId,
                    username: 'User',
                    email: 'user@example.com',
                    full_name: 'User',
                    account_type: 'user',
                    created_at: new Date().toISOString()
                };
                resolve();
            });
        }),
        // 2. Get Latest Profile Analysis
        new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM profile_analysis WHERE user_id = ?${timeFilter.clause} ORDER BY created_at DESC LIMIT 1`,
                [userId, ...timeFilter.params],
                (err, row) => {
                if (err) return reject(err);
                dashboardData.profileAnalysis = row || {
                    followers_count: 0,
                    following_count: 0,
                    ratio: 0,
                    engagement_rate: 0,
                    anomaly_score: 0
                };
                dashboardData.analysisContext.profileTargetUsername = row?.analyzed_username || null;
                dashboardData.analysisContext.profileAnalyzedAt = row?.created_at || null;
                latestProfileRisk = Number.parseFloat(dashboardData.profileAnalysis?.anomaly_score) || 0;
                resolve();
            });
        }),
        // 3. Get Latest Message Analysis
        new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM message_analysis WHERE user_id = ?${timeFilter.clause} ORDER BY created_at DESC LIMIT 1`,
                [userId, ...timeFilter.params],
                (err, row) => {
                if (err) return reject(err);
                dashboardData.messageAnalysis = row || {
                    total_messages: 0,
                    spam_count: 0,
                    scam_count: 0,
                    threat_score: 0,
                    spam_score: 0
                };
                dashboardData.analysisContext.messageAnalyzedAt = row?.created_at || null;
                dashboardData.analysisContext.messageTotalMessages = Number(row?.total_messages || 0);
                latestMessageRisk = Number.parseFloat(dashboardData.messageAnalysis?.threat_score) || 0;
                resolve();
            });
        }),
        // 4. Get Latest Behavior Analysis
        new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM behavior_analysis WHERE user_id = ?${timeFilter.clause} ORDER BY created_at DESC LIMIT 1`,
                [userId, ...timeFilter.params],
                (err, row) => {
                if (err) return reject(err);
                dashboardData.behaviorAnalysis = row || {
                    posting_pattern: 'normal',
                    anomaly_score: 0
                };
                latestBehaviorRisk = Number.parseFloat(dashboardData.behaviorAnalysis?.anomaly_score) || 0;
                resolve();
            });
        }),
        // 5. Get Latest Final Prediction
        new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM final_predictions WHERE user_id = ?${timeFilter.clause} ORDER BY created_at DESC LIMIT 1`,
                [userId, ...timeFilter.params],
                (err, row) => {
                if (err) return reject(err);
                if (row) {
                    dashboardData.overallRisk = row.risk_score || 0;
                    const detailPayload = safeJsonParse(row.explanation_summary);
                    latestPredictionDetails = detailPayload || {};
                    dashboardData.recommendations = Array.isArray(detailPayload?.recommendations) ? detailPayload.recommendations : [
                        "Consider enabling two-factor authentication.",
                        "Review your recent login activity.",
                        "Be cautious of suspicious links in direct messages."
                    ];
                } else {
                    dashboardData.overallRisk = 0;
                    dashboardData.recommendations = [
                        "Run your first analysis to get personalized recommendations.",
                        "Enable two-factor authentication for added security.",
                        "Review your account privacy settings regularly."
                    ];
                }
                resolve();
            });
        }),
        // 6. Get Historical Predictions
        new Promise((resolve, reject) => {
            db.all(
                `SELECT risk_score, risk_level, created_at FROM final_predictions WHERE user_id = ?${timeFilter.clause} ORDER BY created_at ASC LIMIT 10`,
                [userId, ...timeFilter.params],
                (err, rows) => {
                if (err) return reject(err);
                dashboardData.riskHistory = rows && rows.length > 0 ? rows : [];
                dashboardData.anomalies = detectAnomalies(rows || []);
                resolve();
            });
        }),
        // 7. Derive latest profile/message context from prediction payloads
        new Promise((resolve, reject) => {
            db.all(
                `SELECT explanation_summary, created_at
                 FROM final_predictions
                 WHERE user_id = ?${timeFilter.clause}
                 ORDER BY created_at DESC
                 LIMIT 50`,
                [userId, ...timeFilter.params],
                (err, rows) => {
                    if (err) return reject(err);
                    const items = Array.isArray(rows) ? rows : [];
                    for (const row of items) {
                        const details = safeJsonParse(row.explanation_summary) || {};
                        const contentType = String(details.contentType || '').toLowerCase();
                        if (contentType === 'profile' && !dashboardData.analysisContext.profileTargetUsername) {
                            dashboardData.analysisContext.profileTargetUsername = extractProfileTargetUsername(details.content);
                            dashboardData.analysisContext.profileAnalyzedAt =
                                dashboardData.analysisContext.profileAnalyzedAt || row.created_at || null;
                        }
                        if (contentType === 'message' && !dashboardData.analysisContext.messagePreview) {
                            const messageSummary = extractMessageSummary(details.content);
                            dashboardData.analysisContext.messageTargetUsername = messageSummary.conversationName;
                            dashboardData.analysisContext.messagePreview = messageSummary.preview;
                            dashboardData.analysisContext.messageTotalMessages =
                                dashboardData.analysisContext.messageTotalMessages || messageSummary.totalMessages;
                            dashboardData.analysisContext.messageAnalyzedAt =
                                dashboardData.analysisContext.messageAnalyzedAt || row.created_at || null;
                        }
                        if (dashboardData.analysisContext.profileTargetUsername && dashboardData.analysisContext.messagePreview) {
                            break;
                        }
                    }
                    resolve();
                }
            );
        }),
        // 8. Recent analyses + risk delta
        new Promise((resolve, reject) => {
            db.all(
                `SELECT id, risk_score, risk_level, created_at, explanation_summary
                 FROM final_predictions
                 WHERE user_id = ?${timeFilter.clause}
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [userId, ...timeFilter.params],
                (err, rows) => {
                    if (err) return reject(err);
                    const items = Array.isArray(rows) ? rows : [];
                    dashboardData.recentAnalyses = items.map((row) => {
                        const details = safeJsonParse(row.explanation_summary) || {};
                        const contentType = String(details.contentType || 'message').toLowerCase();
                        const profileTarget = contentType === 'profile'
                            ? extractProfileTargetUsername(details.content)
                            : null;
                        const messageSummary = contentType === 'message'
                            ? extractMessageSummary(details.content)
                            : { preview: null, totalMessages: 0, conversationName: null };
                        return {
                            id: row.id,
                            contentType,
                            riskScore: Number(row.risk_score || 0),
                            riskLevel: row.risk_level || 'low',
                            createdAt: row.created_at || null,
                            profileTargetUsername: profileTarget,
                            messageTargetUsername: messageSummary.conversationName,
                            messagePreview: messageSummary.preview,
                        };
                    });

                    if (items.length > 0) {
                        const current = Number(items[0].risk_score || 0);
                        const previous = Number(items[1]?.risk_score || 0);
                        const delta = Number((current - previous).toFixed(1));
                        dashboardData.riskDelta = {
                            current,
                            previous,
                            delta,
                            direction: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),
                        };
                    }
                    resolve();
                }
            );
        })
    ];

    Promise.all(queries)
        .then(() => {
            dashboardData.riskDrivers = {
                profileRisk: latestProfileRisk,
                messageRisk: latestMessageRisk,
                behavioralRisk: latestBehaviorRisk
            };
            dashboardData.topRiskReasons = buildTopRiskReasons({
                profileAnalysis: dashboardData.profileAnalysis,
                messageAnalysis: dashboardData.messageAnalysis,
                behaviorAnalysis: dashboardData.behaviorAnalysis,
                latestPredictionDetails,
            });
            res.status(200).json(dashboardData);
        })
        .catch(err => {
            console.error('Dashboard error:', err);
            res.status(500).json({ 
                message: "Error fetching dashboard data.", 
                error: err.message,
                // IMPORTANT: Still return default structure to prevent "Incomplete data" error on frontend
                dashboardData: {
                    identity: { id: userId, username: 'User' },
                    profileAnalysis: {},
                    messageAnalysis: {},
                    behaviorAnalysis: {},
                    overallRisk: 0,
                    recommendations: ["Unable to load recommendations at this time."],
                    riskHistory: [],
                    riskDrivers: { profileRisk: 0, messageRisk: 0, behavioralRisk: 0 },
                    riskDelta: { current: 0, previous: 0, delta: 0, direction: 'flat' },
                    topRiskReasons: [],
                    recentAnalyses: [],
                    analysisContext: {
                        profileTargetUsername: null,
                        profileAnalyzedAt: null,
                        messageTargetUsername: null,
                        messagePreview: null,
                        messageAnalyzedAt: null,
                        messageTotalMessages: 0,
                    },
                }
            });
        });
});


// scraping endpoint used by extension/client
const { scrapeWithPuppeteer } = require('./scraper');

app.post('/api/scrape', async (req, res) => {
    const { url } = req.body || {};
    if (!url) {
        return res.status(400).json({ error: 'URL required' });
    }
    try {
        const profile = await scrapeWithPuppeteer(url);
        res.json({ success: true, content: JSON.stringify(profile) });
    } catch (err) {
        console.error('Scrape failure', err);
        res.status(500).json({ success: false, error: 'Scrape failed' });
    }
});

const { z } = require('zod');

const analysisSchema = z.object({
    contentType: z.enum(['message', 'profile']),
    content: z.string().min(1),
    url: z.string().url().optional(),
});

const clientAnalysisSchema = z.object({
    contentType: z.enum(['message', 'profile']),
    content: z.string().min(1),
    heuristics: z.record(z.any()),
});

const { spawn, spawnSync } = require('child_process');

const ML_DIR = path.join(__dirname, 'ml');
const PROFILE_PREDICT_SCRIPT = path.join(ML_DIR, 'predict.py');
const MESSAGE_PREDICT_SCRIPT = path.join(ML_DIR, 'predict_messages.py');
const PROFILE_TRAIN_SCRIPT = path.join(ML_DIR, 'train_model.py');
const MESSAGE_TRAIN_SCRIPT = path.join(ML_DIR, 'train_message_models.py');
const PROFILE_MODEL_PRIMARY = path.join(ML_DIR, 'random_forest_model.pkl');
const PROFILE_MODEL_BACKUP = path.join(ML_DIR, 'xgboost_model.pkl');
const MESSAGE_MODEL_PRIMARY = path.join(ML_DIR, 'multinaive_model.pkl');
const MESSAGE_MODEL_BACKUP = path.join(ML_DIR, 'message_logistic_regression_model.pkl');
const MESSAGE_VECTORIZER = path.join(ML_DIR, 'message_vectorizer.pkl');

function fileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function runPythonScript(scriptPath, payload) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [scriptPath, JSON.stringify(payload)], { cwd: __dirname });

        let result = '';
        let stderrOutput = '';
        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(`Python script exited with code ${code}${stderrOutput ? `: ${stderrOutput.trim()}` : ''}`);
            }
            if (stderrOutput.trim()) {
                console.warn(`[ML] ${path.basename(scriptPath)} stderr: ${stderrOutput.trim()}`);
            }
            try {
                resolve(JSON.parse(result));
            } catch (e) {
                reject(`Failed to parse python script output${stderrOutput ? ` (stderr: ${stderrOutput.trim()})` : ''}`);
            }
        });

        pythonProcess.on('error', (error) => {
            reject(`Failed to start python process: ${error.message}`);
        });
    });
}

function ensureProfileModelsTrained(force = false) {
    if (!force && (fileExists(PROFILE_MODEL_PRIMARY) || fileExists(PROFILE_MODEL_BACKUP))) return;
    const datasetPath = path.resolve(__dirname, '..', 'profiledatset', 'train.csv');
    if (!fileExists(datasetPath)) return;
    const result = spawnSync('python', [PROFILE_TRAIN_SCRIPT], {
        cwd: __dirname,
        env: { ...process.env, PROFILE_DATASET_PATH: datasetPath },
        encoding: 'utf-8'
    });
    if (result.status !== 0) {
        console.error('Profile model training failed:', result.stderr || result.stdout);
    }
}

function ensureMessageModelsTrained(force = false) {
    const hasMessageModel = fileExists(MESSAGE_MODEL_PRIMARY) || fileExists(MESSAGE_MODEL_BACKUP);
    if (!force && hasMessageModel && fileExists(MESSAGE_VECTORIZER)) return;
    const datasetPath = path.resolve(__dirname, '..', 'messagedatasets', 'spam.csv');
    if (!fileExists(datasetPath)) return;
    const result = spawnSync('python', [MESSAGE_TRAIN_SCRIPT], {
        cwd: __dirname,
        env: { ...process.env, MESSAGE_DATASET_PATH: datasetPath },
        encoding: 'utf-8'
    });
    if (result.status !== 0) {
        console.error('Message model training failed:', result.stderr || result.stdout);
    }
}

function normalizeMessageList(content) {
    const payload = parseMessageContentPayload(content);
    return payload.messages;
}

function parseMessageContentPayload(content) {
    if (Array.isArray(content)) {
        return {
            messages: content.map((msg) => String(msg || '').trim()).filter(Boolean),
            rawMessages: [],
            rawMessageEvents: [],
        };
    }
    if (content && typeof content === 'object') {
        const messages = Array.isArray(content.messages) ? content.messages : [];
        const rawMessages = Array.isArray(content.rawMessages) ? content.rawMessages : messages;
        const rawMessageEvents = Array.isArray(content.rawMessageEvents) ? content.rawMessageEvents : [];
        return {
            messages: messages.map((msg) => String(msg || '').trim()).filter(Boolean),
            rawMessages: rawMessages.map((msg) => String(msg || '').trim()).filter(Boolean),
            rawMessageEvents,
        };
    }
    const text = String(content || '');
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
                const rawMessages = Array.isArray(parsed.rawMessages) ? parsed.rawMessages : messages;
                const rawMessageEvents = Array.isArray(parsed.rawMessageEvents) ? parsed.rawMessageEvents : [];
                return {
                    messages: messages.map((msg) => String(msg || '').trim()).filter(Boolean),
                    rawMessages: rawMessages.map((msg) => String(msg || '').trim()).filter(Boolean),
                    rawMessageEvents,
                };
            }
            if (Array.isArray(parsed)) {
                return {
                    messages: parsed.map((msg) => String(msg || '').trim()).filter(Boolean),
                    rawMessages: [],
                    rawMessageEvents: [],
                };
            }
        } catch {
            // fall through to newline parser
        }
    }
    const lines = text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) return { messages: lines, rawMessages: [], rawMessageEvents: [] };
    return trimmed ? { messages: [trimmed], rawMessages: [], rawMessageEvents: [] } : { messages: [], rawMessages: [], rawMessageEvents: [] };
}

function buildProfileModelFeatures(profileContent) {
    const parsed = safeJsonParse(profileContent) || {};
    const username = String(parsed.username || '');
    const fullName = String(parsed.fullName || parsed.full_name || '');
    const bio = String(parsed.bio || parsed.biography || '');
    const followers = Number(parsed.followers ?? parsed.followersCount ?? 0) || 0;
    const follows = Number(parsed.following ?? parsed.followingCount ?? 0) || 0;
    const posts = Number(parsed.postCount ?? parsed.postsCount ?? parsed.totalPosts ?? 0) || 0;

    return {
        'profile pic': parsed.hasProfilePic ? 1 : 0,
        'nums/length username': username.length > 0 ? username.replace(/[^0-9]/g, '').length / username.length : 0,
        'fullname words': fullName.trim() ? fullName.trim().split(/\s+/).length : 0,
        'nums/length fullname': fullName.length > 0 ? fullName.replace(/[^0-9]/g, '').length / fullName.length : 0,
        'name==username': fullName && username && fullName.toLowerCase() === username.toLowerCase() ? 1 : 0,
        'description length': bio.length,
        'external URL': parsed.hasExternalUrl ? 1 : 0,
        'private': parsed.private || parsed.isPrivate ? 1 : 0,
        '#posts': posts,
        '#followers': followers,
        '#follows': follows,
    };
}

async function getProfilePrediction(profileContent) {
    ensureProfileModelsTrained();
    const payload = buildProfileModelFeatures(profileContent);
    let result;
    try {
        result = await runPythonScript(PROFILE_PREDICT_SCRIPT, payload);
    } catch (error) {
        ensureProfileModelsTrained(true);
        result = await runPythonScript(PROFILE_PREDICT_SCRIPT, payload);
    }
    const rawPrediction = Number(result?.prediction ?? 0);
    return {
        riskScore: clampScore(rawPrediction * 100),
        modelUsed: result?.model_used || 'RandomForest/XGBoost',
    };
}

async function getMessagePrediction(content) {
    ensureMessageModelsTrained();
    const messages = normalizeMessageList(content);
    if (messages.length === 0) {
        return { riskScore: 0, modelUsed: 'none' };
    }
    let result;
    try {
        result = await runPythonScript(MESSAGE_PREDICT_SCRIPT, { messages });
    } catch (error) {
        ensureMessageModelsTrained(true);
        result = await runPythonScript(MESSAGE_PREDICT_SCRIPT, { messages });
    }
    return {
        riskScore: clampScore(Number(result?.risk_score ?? 0) * 100),
        modelUsed: result?.model_used
            ? `${result.model_used} (thr=${Number(result?.threshold_used ?? 0.5).toFixed(2)}, meanProb=${Number(result?.mean_probability ?? 0).toFixed(3)})`
            : 'MultinomialNB/LogisticRegression',
    };
}

function runDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function getDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function allDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function clampScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > 100) return 100;
    return num;
}

function sigmoid(value) {
    const x = Number(value);
    if (!Number.isFinite(x)) return 0.5;
    return 1 / (1 + Math.exp(-x));
}

function calibrateProfileRiskScore(rawRiskScore, profileMetrics) {
    const raw = clampScore(rawRiskScore);
    const interactionSamples = Number(profileMetrics?.computedFeatures?.interactionSamples || 0);
    const detailsFetched = Number(profileMetrics?.computedFeatures?.detailsFetched || 0);
    const accountAgeDays = Number(profileMetrics?.accountAgeDays || 0);
    const dataQuality = Math.min(
        1,
        (interactionSamples >= 12 ? 0.45 : interactionSamples >= 5 ? 0.3 : 0.1) +
        (detailsFetched >= 12 ? 0.3 : detailsFetched >= 5 ? 0.2 : 0.05) +
        (accountAgeDays > 0 ? 0.25 : 0)
    );
    const centerAdjusted = (raw - 50) / 10;
    const baseProb = sigmoid(centerAdjusted);
    const calibratedProb = clampScore(
        ((baseProb * (0.6 + 0.4 * dataQuality)) + ((raw / 100) * (0.4 - 0.2 * dataQuality))) * 100
    ) / 100;
    const calibratedRiskScore = clampScore(Math.round(calibratedProb * 100));
    return { calibratedRiskScore, calibratedProb, dataQuality };
}

function toRiskLevel(score) {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function resolveLogPath(filename) {
    const candidates = [
        path.join(__dirname, filename),
        path.join(__dirname, '..', filename),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function readLogLines(filename, limit = 150) {
    const resolved = resolveLogPath(filename);
    if (!resolved) {
        return { source: filename, lines: [], missing: true, lastUpdated: null };
    }
    try {
        const raw = fs.readFileSync(resolved, 'utf-8');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        const stat = fs.statSync(resolved);
        return {
            source: path.basename(resolved),
            lines: lines.slice(-limit),
            missing: false,
            lastUpdated: stat?.mtime ? stat.mtime.toISOString() : null,
        };
    } catch (error) {
        return { source: filename, lines: [], missing: true, lastUpdated: null, error: error.message };
    }
}

function normalizeWindow(rawWindow) {
    const value = String(rawWindow || 'all').toLowerCase();
    const allowed = new Set(['5m', '1h', '1d', '7d', 'all']);
    return allowed.has(value) ? value : 'all';
}

function getTimeFilter(windowKey, columnName = 'created_at') {
    const map = {
        '5m': '-5 minutes',
        '1h': '-1 hour',
        '1d': '-1 day',
        '7d': '-7 days',
        'all': null,
    };
    const modifier = map[windowKey] ?? null;
    if (!modifier) return { clause: '', params: [] };
    return {
        clause: ` AND datetime(${columnName}) >= datetime('now', ?)`,
        params: [modifier],
    };
}

function countKeywordHits(text, keywords) {
    if (!text) return 0;
    const lower = String(text).toLowerCase();
    return keywords.reduce((count, kw) => count + (lower.includes(kw) ? 1 : 0), 0);
}

const PROFILE_EVIDENCE_PRESETS = {
    strict: { minInteractionSamples: 6, minDetailsFetched: 6, minDataCompleteness: 0.75 },
    balanced: { minInteractionSamples: 4, minDetailsFetched: 4, minDataCompleteness: 0.65 },
    lenient: { minInteractionSamples: 2, minDetailsFetched: 2, minDataCompleteness: 0.5 },
};
const ACTIVE_PROFILE_EVIDENCE_PRESET = process.env.PROFILE_EVIDENCE_PRESET || 'balanced';
const PROFILE_EVIDENCE_POLICY =
    PROFILE_EVIDENCE_PRESETS[ACTIVE_PROFILE_EVIDENCE_PRESET] || PROFILE_EVIDENCE_PRESETS.balanced;
const PROFILE_EVIDENCE_GATES = {
    minDataCompleteness: 0.6,
};
const PROFILE_RISK_CAPS = {
    insufficientData: 45,
    privateZeroPost: 35,
    publicZeroPost: 50,
    suspiciousButIncomplete: 60,
};

function applyProfileRiskGuards(rawRiskScore, profileMetrics) {
    const features = profileMetrics?.computedFeatures || {};
    const dataCompletenessRaw = Number(features?.dataCompleteness);
    const dataCompleteness = Number.isFinite(dataCompletenessRaw) ? dataCompletenessRaw : 0;
    const interactionSamples = Number(features?.interactionSamples || 0);
    const detailsFetched = Number(features?.detailsFetched || 0);
    const suspiciousBioKeywordCount = Number(profileMetrics?.suspiciousBioKeywordCount || 0);
    const usernameDigitRatio = Number(profileMetrics?.usernameDigitRatio || 0);
    const followerFollowingRatio = Number(profileMetrics?.ratio || 0);
    const totalPosts = Number(profileMetrics?.totalPosts || 0);
    const isPrivate = profileMetrics?.isPrivate === true;
    const strongMaliciousSignals =
        suspiciousBioKeywordCount >= 3 ||
        (suspiciousBioKeywordCount >= 1 && followerFollowingRatio > 120 && usernameDigitRatio > 0.4);
    const hasMinimalEvidence =
        interactionSamples > 0 &&
        detailsFetched > 0 &&
        dataCompleteness >= PROFILE_EVIDENCE_GATES.minDataCompleteness;
    const insufficientData = profileMetrics?.insufficientData === true || !hasMinimalEvidence;

    let adjustedRiskScore = clampScore(rawRiskScore);
    if (insufficientData) {
        adjustedRiskScore = Math.min(
            adjustedRiskScore,
            strongMaliciousSignals ? PROFILE_RISK_CAPS.suspiciousButIncomplete : PROFILE_RISK_CAPS.insufficientData
        );
    }
    if (totalPosts === 0 && suspiciousBioKeywordCount === 0) {
        adjustedRiskScore = Math.min(
            adjustedRiskScore,
            isPrivate ? PROFILE_RISK_CAPS.privateZeroPost : PROFILE_RISK_CAPS.publicZeroPost
        );
    }

    return {
        riskScore: clampScore(Math.round(adjustedRiskScore)),
        insufficientData,
        evidenceCompletenessScore: clampScore(Math.round(dataCompleteness * 100)),
    };
}

function deriveClassificationTag(contentType, profileMetrics, messageMetrics, riskScore) {
    if (contentType === 'message') {
        const credentialKeywordCount = Number(messageMetrics?.credentialKeywordCount || 0);
        const phishingLinkCount = Number(messageMetrics?.phishingLinkCount || 0);
        const selfHarmCount = Number(messageMetrics?.selfHarmCount || 0);
        const violenceThreatCount = Number(messageMetrics?.violenceThreatCount || 0);
        const blackmailSextortionCount = Number(messageMetrics?.blackmailSextortionCount || 0);
        const harassmentCount = Number(messageMetrics?.harassmentCount || 0);
        const sexualSolicitationCount = Number(messageMetrics?.sexualSolicitationCount || 0);
        const scamKeywordCount = Number(messageMetrics?.computedFeatures?.scamKeywordCount || 0);
        const impersonationKeywordCount = Number(messageMetrics?.computedFeatures?.impersonationKeywordCount || 0);
        const financialPressureCount = Number(messageMetrics?.computedFeatures?.financialPressureCount || 0);
        const mediaRiskSignals = Number(messageMetrics?.computedFeatures?.mediaRiskSignals || 0);
        const brandTyposquatCount = Number(messageMetrics?.computedFeatures?.brandTyposquatCount || 0);
        const strongPhishingPattern =
            phishingLinkCount > 0 &&
            (credentialKeywordCount > 0 || impersonationKeywordCount > 0);
        if (selfHarmCount > 0) return 'self-harm-risk';
        if (blackmailSextortionCount > 0) return 'sextortion-blackmail';
        if (violenceThreatCount > 0) return 'violent-threat';
        if (sexualSolicitationCount > 0) return 'sexual-solicitation';
        if (harassmentCount >= 2) return 'abusive-harassment';
        const classModel = computeMessageClassScores(messageMetrics, riskScore);
        if (classModel.label !== 'likely-human') return classModel.label;
        if (
            riskScore >= 45 ||
            strongPhishingPattern ||
            mediaRiskSignals >= 2 ||
            brandTyposquatCount > 0 ||
            (scamKeywordCount >= 2 && (financialPressureCount > 0 || impersonationKeywordCount > 0))
        ) return 'suspicious-message';
        return 'likely-human';
    }

    if (contentType === 'profile') {
        if (profileMetrics?.insufficientData) return 'insufficient-data';
        const isVeryNewAccount = Number(profileMetrics?.accountAgeDays || 0) > 0 && Number(profileMetrics?.accountAgeDays || 0) < 45;
        const botSignalCount = [
            (profileMetrics?.ratio || 0) > 20,
            (profileMetrics?.totalPosts || 0) < 5,
            (profileMetrics?.hasProfilePic === false),
            (profileMetrics?.usernameDigitRatio || 0) > 0.35,
        ].filter(Boolean).length;
        if (riskScore >= 70 && botSignalCount >= 2 && !isVeryNewAccount) return 'bot';
        if (riskScore >= 65 && (profileMetrics?.suspiciousBioKeywordCount || 0) > 0) return 'scam';
        if (riskScore < 35 && (profileMetrics?.totalPosts || 0) >= 5 && profileMetrics?.hasProfilePic) return 'human';
        return 'suspicious-profile';
    }

    return riskScore >= 70 ? 'scam' : riskScore >= 40 ? 'suspicious' : 'likely-human';
}

function computeMessageClassScores(messageMetrics, riskScore) {
    const computed = messageMetrics?.computedFeatures || {};
    const repetitionRatio = Number(messageMetrics?.repetitionRatio || computed?.repetitionRatio || 0);
    const consecutiveRepeatCount = Number(messageMetrics?.consecutiveRepeatCount || computed?.consecutiveRepeatCount || 0);
    const suspiciousKeywordCount = Number(messageMetrics?.suspiciousKeywordCount || 0);
    const scamKeywordCount = Number(computed?.scamKeywordCount || 0);
    const credentialKeywordCount = Number(messageMetrics?.credentialKeywordCount || 0);
    const impersonationKeywordCount = Number(computed?.impersonationKeywordCount || 0);
    const financialPressureCount = Number(computed?.financialPressureCount || 0);
    const phishingLinkCount = Number(messageMetrics?.phishingLinkCount || 0);
    const brandTyposquatCount = Number(computed?.brandTyposquatCount || 0);
    const suspiciousDomainCount = Number(computed?.suspiciousDomainCount || 0);
    const riskyTldCount = Number(computed?.riskyTldCount || 0);
    const obfuscatedLinkSignals = Number(computed?.obfuscatedLinkSignals || 0);
    const suspiciousPathHits = Number(computed?.suspiciousPathHits || 0);
    const rapidFireRatio = Number(messageMetrics?.rapidFireRatio || computed?.rapidFireRatio || 0);
    const maxBurst2Min = Number(computed?.maxBurst2Min || 0);
    const shortMessageRatio = Number(computed?.shortMessageRatio || 0);
    const broadcastHits = Number(computed?.broadcastHits || 0);
    const credentialTransferCount = Number(computed?.credentialTransferCount || 0);
    const genericCodeRequestCount = Number(computed?.genericCodeRequestCount || 0);
    const otpCryptoComboDetected = Number(computed?.otpCryptoComboDetected || 0) > 0;
    const platformSwitchCount = Number(computed?.platformSwitchCount || 0);
    const redirectionIntentCount = Number(computed?.redirectionIntentCount || 0);
    const recruitmentScamCount = Number(computed?.recruitmentScamCount || 0);

    const phishing = clampScore(Math.round(
        (phishingLinkCount * 24) +
        (credentialKeywordCount * 8) +
        (impersonationKeywordCount * 8) +
        (brandTyposquatCount * 10) +
        (suspiciousDomainCount * 8) +
        (riskyTldCount * 6) +
        (obfuscatedLinkSignals * 5) +
        (suspiciousPathHits * 4)
    ));
    const hacker = clampScore(Math.round(
        (credentialTransferCount * 22) +
        (genericCodeRequestCount * 10) +
        (credentialKeywordCount * 7) +
        (impersonationKeywordCount * 7) +
        (financialPressureCount * 6) +
        (otpCryptoComboDetected ? 10 : 0) +
        (riskScore >= 65 ? 8 : 0)
    ));
    const scam = clampScore(Math.round(
        (scamKeywordCount * 9) +
        (financialPressureCount * 10) +
        (Number(computed?.cryptoContextCount || 0) * 6) +
        (recruitmentScamCount * 10) +
        (otpCryptoComboDetected ? 10 : 0) +
        ((messageMetrics?.scamCount || 0) > 0 ? 15 : 0) +
        (broadcastHits * 6) +
        ((platformSwitchCount > 0 && redirectionIntentCount > 0) ? 10 : 0) +
        (riskScore * 0.25)
    ));
    const spam = clampScore(Math.round(
        (repetitionRatio * 40) +
        (consecutiveRepeatCount * 8) +
        (broadcastHits * 8) +
        (suspiciousKeywordCount * 1.2) +
        ((messageMetrics?.totalMessages || 0) >= 25 ? 6 : 0)
    ));
    const bot = clampScore(Math.round(
        (repetitionRatio * 45) +
        (consecutiveRepeatCount * 10) +
        (rapidFireRatio * 40) +
        (maxBurst2Min * 6) +
        (shortMessageRatio * 20) +
        (Number(computed?.incomingRatio || 0) > 0.85 ? 8 : 0)
    ));

    const classScores = { bot, spam, scam, phishing, hacker };
    const ranking = Object.entries(classScores).sort((a, b) => b[1] - a[1]);
    const topClass = String(ranking[0]?.[0] || 'spam');
    const topScore = Number(ranking[0]?.[1] || 0);
    const secondScore = Number(ranking[1]?.[1] || 0);
    const margin = clampScore(Math.round(topScore - secondScore));
    const highClassCount = Object.values(classScores).filter((score) => Number(score) >= 45).length;
    const mixed = ((highClassCount >= 2 && margin <= 8) || highClassCount >= 3) && topScore >= 45;

    let label = 'likely-human';
    if (mixed) label = 'mixed-risk';
    else if (topScore >= 40) {
        if (topClass === 'phishing') label = 'phishing-risk';
        else if (topClass === 'hacker') label = 'hacker-risk';
        else if (topClass === 'scam') label = 'scam';
        else if (topClass === 'bot') label = 'bot';
        else if (topClass === 'spam') label = 'spam';
    } else if (riskScore >= 40) {
        label = 'suspicious-message';
    }

    return {
        label,
        classScores,
        topClass,
        topScore,
        secondScore,
        margin,
        mixed,
        highClassCount,
    };
}

function toScore100(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return clampScore(fallback);
    if (num >= 0 && num <= 1) return clampScore(Math.round(num * 100));
    return clampScore(Math.round(num));
}

function normalizeClientMessageHeuristics(heuristics) {
    const src = heuristics || {};
    return {
        overallRisk: toScore100(src.overallRisk ?? src.preliminaryRiskScore ?? src.riskScore, 0),
        evidenceQuality: toScore100(src.evidenceQuality, 45),
        spamScore: toScore100(src.spamScore, 0),
        urgentScore: toScore100(src.urgentScore, 0),
        behavioralScore: toScore100(src.behavioralScore, 0),
        suspiciousLinkCount: Math.max(0, Number(src.suspiciousLinkCount || 0)),
        credentialHits: Math.max(0, Number(src.credentialHits || 0)),
        impersonationHits: Math.max(0, Number(src.impersonationHits || 0)),
        pressureHits: Math.max(0, Number(src.pressureHits || 0)),
        riskClass: String(src.riskClass || '').toLowerCase(),
    };
}

function buildMessageFlags(messageMetrics) {
    const flags = [];
    const computed = messageMetrics?.computedFeatures || {};
    if (messageMetrics?.suspiciousKeywordCount) flags.push('Suspicious message indicators detected');
    if (Number(messageMetrics?.selfHarmCount || 0) > 0) flags.push('Self-harm intent indicators detected');
    if (Number(messageMetrics?.violenceThreatCount || 0) > 0) flags.push('Violence threat indicators detected');
    if (Number(messageMetrics?.blackmailSextortionCount || 0) > 0) flags.push('Blackmail/sextortion indicators detected');
    if (Number(messageMetrics?.sexualSolicitationCount || 0) > 0) flags.push('Sexual solicitation indicators detected');
    if (Number(messageMetrics?.harassmentCount || 0) > 0) flags.push('Harassment/abuse indicators detected');
    if (Number(messageMetrics?.credentialKeywordCount || 0) > 0 && Number(messageMetrics?.phishingLinkCount || 0) > 0) {
        flags.push('Credential phishing pattern detected');
    }
    if (Number(computed?.credentialTransferCount || 0) > 0) flags.push('Direct credential transfer request detected');
    if (Number(computed?.platformSwitchCount || 0) > 0 && Number(computed?.redirectionIntentCount || 0) > 0) {
        flags.push('Conversation redirection to external platform detected');
    }
    if (Number(computed?.recruitmentScamCount || 0) > 0) {
        flags.push('Recruitment/income-claim scam pattern detected');
    }
    if (Number(computed?.otpCryptoComboDetected || 0) > 0) flags.push('OTP + crypto context combination detected');
    return flags;
}

function buildMessageRecommendations(classificationTag, riskScore) {
    const tag = String(classificationTag || '').toLowerCase();
    if (tag === 'self-harm-risk') {
        return [
            'Treat this as urgent. Encourage immediate contact with local emergency services or a trusted person.',
            'Do not leave the person isolated in chat; keep communication open and supportive.',
            'Escalate to platform safety/support workflows immediately.',
        ];
    }
    if (tag === 'violent-threat' || tag === 'sextortion-blackmail') {
        return [
            'Do not engage or negotiate with the sender.',
            'Preserve evidence (screenshots, message headers, timestamps) and report to platform support.',
            'If threat appears credible, contact local law enforcement immediately.',
        ];
    }
    if (tag === 'phishing-risk' || tag === 'hacker-risk') {
        return [
            'Assume account-takeover attempt and stop all credential sharing immediately.',
            'Reset password, rotate 2FA secrets, and revoke active sessions.',
            'Report the sender and preserve message evidence for security review.',
        ];
    }
    if (tag === 'mixed-risk') {
        return [
            'Conversation contains conflicting high-risk signals; keep interaction restricted.',
            'Require out-of-band verification before sharing any sensitive details.',
            'Monitor next messages for escalation to credential or payment requests.',
        ];
    }
    if (tag === 'bot' || tag === 'spam') {
        return [
            'Limit engagement and avoid replying to repetitive template-like messages.',
            'Block/report if message bursts or repeated solicitations continue.',
            'Do not follow external links from low-context automated accounts.',
        ];
    }
    if (riskScore >= 70) {
        return [
            'Stop replying and block/report the sender.',
            'Avoid opening links or sharing OTP/password/payment details.',
            'Enable 2FA and review account sessions for unauthorized access.',
        ];
    }
    if (riskScore >= 40) {
        return [
            'Proceed cautiously and verify identity via trusted channels.',
            'Do not share sensitive data until authenticity is confirmed.',
            'Monitor for repeated phishing or pressure tactics.',
        ];
    }
    return ['No strong malicious pattern detected. Continue normal caution and monitor new messages.'];
}

function extractProfileMetrics(profileContent, heuristics) {
    const toNumberOrNull = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    };
    const toFiniteOr = (value, fallback) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    };
    const sanitizeSentinel = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        if (num >= 900 || num <= -900) return null;
        return num;
    };
    const toTimestampSec = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return null;
        // Normalize milliseconds to seconds when needed.
        return n > 1e12 ? Math.trunc(n / 1000) : Math.trunc(n);
    };
    const pickPositiveOr = (candidate, fallback) => {
        const n = Number(candidate);
        if (Number.isFinite(n) && n > 0) return n;
        return fallback;
    };

    const parsed = safeJsonParse(profileContent);
    const postsArray = Array.isArray(parsed?.posts) ? parsed.posts : [];
    const reelsArray = Array.isArray(parsed?.reels) ? parsed.reels : [];
    const postCountFromArray = postsArray.length;
    const explicitPosts = Number(parsed?.postsCount ?? parsed?.totalPosts);
    const totalPosts = Number.isFinite(explicitPosts) ? explicitPosts : postCountFromArray;
    const followers = Number(parsed?.followers ?? parsed?.followersCount ?? 0) || 0;
    const following = Number(parsed?.following ?? parsed?.followingCount ?? 0) || 0;
    const ratio = following > 0 ? followers / following : followers > 0 ? followers : 0;
    const engagementRate = Number(
        heuristics?.structuralMetrics?.engagementRate ??
        heuristics?.observedSignals?.avgEngagement ??
        heuristics?.avgEngagement ??
        0
    ) || 0;
    const isPrivate = !!(parsed?.isPrivate ?? parsed?.private);
    const hasProfilePic = !!(parsed?.hasProfilePic ?? parsed?.profilePic ?? parsed?.profile_picture_url ?? parsed?.profile_pic_url_hd);
    const username = String(parsed?.username ?? '');
    const usernameDigitRatio = username.length > 0 ? (username.replace(/[^0-9]/g, '').length / username.length) : 0;
    const bio = String(parsed?.bio ?? parsed?.biography ?? '');
    const suspiciousBioKeywordCount = countKeywordHits(bio, [
        'crypto', 'investment', 'guaranteed', 'telegram', 'whatsapp', 'trading', 'forex', 'wallet', 'airdrop', 'double money'
    ]);
    const mediaItems = [...postsArray, ...reelsArray];
    const observedCommentSamples = postsArray.reduce((sum, item) => {
        if (!Array.isArray(item?.comments)) return sum;
        return sum + item.comments.length;
    }, 0);
    const timestamps = mediaItems
        .map((item) => toTimestampSec(
            item?.takenAtTimestamp ??
            item?.taken_at_timestamp ??
            item?.timestamp ??
            item?.createdAtTimestamp ??
            item?.created_time ??
            null
        ))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
    const nowSec = Math.floor(Date.now() / 1000);
    const oldestTs = timestamps.length > 0 ? timestamps[0] : null;
    const newestTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
    const activeSpanDaysRaw = oldestTs && newestTs ? Math.max(1, (newestTs - oldestTs) / 86400) : 0;
    const inferredAccountAgeDays = oldestTs ? Math.max(1, (nowSec - oldestTs) / 86400) : 0;
    const accountAgeDays = pickPositiveOr(
        heuristics?.accountAgeDays ??
        heuristics?.observedSignals?.temporalMetrics?.accountAgeDays ??
        heuristics?.temporalMetrics?.accountAgeDays ??
        inferredAccountAgeDays
    , inferredAccountAgeDays);
    const activeSpanDays = pickPositiveOr(
        heuristics?.temporalMetrics?.activeSpanDays ??
        heuristics?.observedSignals?.temporalMetrics?.activeSpanDays ??
        activeSpanDaysRaw
    , activeSpanDaysRaw);
    const postingVelocity = accountAgeDays > 0 ? (totalPosts / accountAgeDays) : 0;
    const followerGrowthPerDayProxy = toFiniteOr(
        heuristics?.temporalMetrics?.followerGrowthPerDayProxy ??
        heuristics?.observedSignals?.temporalMetrics?.followerGrowthPerDayProxy ??
        (accountAgeDays > 0 ? followers / accountAgeDays : 0)
    , 0);
    const postingRecencyDays = toFiniteOr(
        heuristics?.temporalMetrics?.postingRecencyDays ??
        heuristics?.observedSignals?.temporalMetrics?.postingRecencyDays ??
        (newestTs ? Math.max(0, (nowSec - newestTs) / 86400) : 0)
    , 0);
    const activityTimeEntropy = toFiniteOr(
        heuristics?.temporalMetrics?.activityTimeEntropy ??
        heuristics?.observedSignals?.temporalMetrics?.activityTimeEntropy ??
        0
    , 0);
    const normalizedFollowerFollowingRatio = toFiniteOr(
        heuristics?.normalizedFollowerFollowingRatio ??
        heuristics?.observedSignals?.normalizedFollowerFollowingRatio ??
        Math.log10((followers + 1) / (following + 1))
    , 0);
    const interactionDensity = toFiniteOr(
        heuristics?.interactionDensity ??
        heuristics?.observedSignals?.interactionDensity ??
        0
    , 0);
    const diagnosticsCommentUsersObserved = toFiniteOr(
        heuristics?.mediaCollectionDiagnostics?.commentUsersObserved ??
        heuristics?.observedSignals?.mediaCollectionDiagnostics?.commentUsersObserved ??
        0,
        0
    );
    let commentUniquenessRatio = sanitizeSentinel(
        heuristics?.commentUniquenessRatio ??
        heuristics?.observedSignals?.commentUniquenessRatio ??
        null
    );
    let uniqueCommentUsers = sanitizeSentinel(
        heuristics?.uniqueCommentUsers ??
        heuristics?.observedSignals?.uniqueCommentUsers ??
        null
    );
    if ((!Number.isFinite(uniqueCommentUsers) || uniqueCommentUsers <= 0) && diagnosticsCommentUsersObserved > 0) {
        uniqueCommentUsers = diagnosticsCommentUsersObserved;
    }
    if ((!Number.isFinite(commentUniquenessRatio) || commentUniquenessRatio <= 0) && Number.isFinite(uniqueCommentUsers) && uniqueCommentUsers > 0) {
        commentUniquenessRatio = 1;
    }
    if (!Number.isFinite(commentUniquenessRatio)) commentUniquenessRatio = 0;
    if (!Number.isFinite(uniqueCommentUsers)) uniqueCommentUsers = 0;
    const mediaCollectionDiagnostics = heuristics?.mediaCollectionDiagnostics || heuristics?.observedSignals?.mediaCollectionDiagnostics || {};
    const inferredDetailsFetched = Math.min(25, mediaItems.length);
    const detailsFetched = toFiniteOr(
        mediaCollectionDiagnostics?.detailsFetched ??
        heuristics?.mediaCollectionDiagnostics?.detailsFetched ??
        heuristics?.observedSignals?.mediaCollectionDiagnostics?.detailsFetched ??
        inferredDetailsFetched,
        inferredDetailsFetched
    );
    const inferredInteractionSamples = Math.min(25, Math.max(observedCommentSamples, mediaItems.length));
    const inferredDataCompleteness = (
        [
            Number.isFinite(followers),
            Number.isFinite(following),
            totalPosts > 0,
            mediaItems.length > 0,
            timestamps.length > 0,
            observedCommentSamples > 0 || engagementRate > 0,
            bio.length > 0,
        ].filter(Boolean).length / 7
    );
    const dataCompleteness = toFiniteOr(
        heuristics?.dataCompleteness ??
        heuristics?.observedSignals?.dataCompleteness ??
        inferredDataCompleteness,
    inferredDataCompleteness);
    const interactionSamples = toFiniteOr(
        heuristics?.interactionSamples ??
        heuristics?.observedSignals?.interactionSamples ??
        inferredInteractionSamples,
    inferredInteractionSamples);
    const sampleCoverageRatio = toNumberOrNull(
        heuristics?.sampleCoverageRatio ??
        heuristics?.observedSignals?.sampleCoverageRatio
    );
    const behavioralUnavailable = heuristics?.behavioralUnavailable === true;
    const requiresBehavioralValidation = heuristics?.requiresBehavioralValidation === true;
    const behavioralRequired = heuristics?.behavioralRequired === true;
    const insufficientData =
        (requiresBehavioralValidation || behavioralRequired) &&
        (
            behavioralUnavailable ||
            interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples ||
            detailsFetched < PROFILE_EVIDENCE_POLICY.minDetailsFetched
        );
    const completenessInsufficient =
        dataCompleteness < PROFILE_EVIDENCE_POLICY.minDataCompleteness &&
        (
            interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples ||
            detailsFetched < PROFILE_EVIDENCE_POLICY.minDetailsFetched
        );
    const lowEvidenceInsufficient =
        interactionSamples === 0 ||
        detailsFetched === 0 ||
        dataCompleteness < PROFILE_EVIDENCE_GATES.minDataCompleteness;
    const finalInsufficientData = insufficientData || completenessInsufficient || lowEvidenceInsufficient;
    const isVeryNewAccount = accountAgeDays > 0 && accountAgeDays < 45;

    let inferredAnomaly = 0;
    if (ratio > 80) inferredAnomaly += isVeryNewAccount ? 16 : 30;
    else if (ratio > 20) inferredAnomaly += isVeryNewAccount ? 10 : 20;
    else if (ratio > 10) inferredAnomaly += isVeryNewAccount ? 6 : 10;
    if (!hasProfilePic) inferredAnomaly += 20;
    if (totalPosts < 3) inferredAnomaly += isVeryNewAccount ? 8 : 20;
    else if (totalPosts < 10) inferredAnomaly += isVeryNewAccount ? 4 : 10;
    inferredAnomaly += Math.min(24, suspiciousBioKeywordCount * 8);
    if (usernameDigitRatio > 0.4) inferredAnomaly += 10;
    if (followers < 20 && following > 500) inferredAnomaly += isVeryNewAccount ? 7 : 15;
    if (isPrivate && totalPosts === 0 && following > 300) inferredAnomaly += 10;
    if (engagementRate > 0 && engagementRate < 0.01) inferredAnomaly += 8;
    if (postingVelocity > 3 && !(isVeryNewAccount && totalPosts < 12)) inferredAnomaly += 6;
    if (postingRecencyDays > 120 && totalPosts > 50) inferredAnomaly += 6;
    if (interactionDensity > 0 && interactionDensity < 0.2) inferredAnomaly += 5;
    if (activityTimeEntropy > 0 && activityTimeEntropy < 1.5 && totalPosts >= 20) inferredAnomaly += 6;
    if (normalizedFollowerFollowingRatio > 4.5 && interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples) inferredAnomaly += 8;
    if (
        uniqueCommentUsers >= 10 &&
        interactionSamples >= 8 &&
        commentUniquenessRatio > 0 &&
        commentUniquenessRatio < 0.25
    ) inferredAnomaly += 8;

    const anomalyScore = clampScore(heuristics?.preliminaryRiskScore ?? inferredAnomaly);
    const computedFeatures = {
        suspiciousBioKeywordCount,
        usernameDigitRatio,
        hasProfilePic,
        engagementRate,
        postingVelocity,
        accountAgeDays,
        activeSpanDays,
        followerGrowthPerDayProxy,
        postingRecencyDays,
        activityTimeEntropy,
        normalizedFollowerFollowingRatio,
        normalizedFollowerFollowingRatioScale: 'log10',
        interactionDensity,
        commentUniquenessRatio,
        uniqueCommentUsers,
        sampleCoverageRatio,
        interactionSamples,
        detailsFetched,
        dataCompleteness,
        evidenceCompletenessScore: clampScore(Math.round(dataCompleteness * 100)),
        insufficientData: finalInsufficientData,
        inferredAnomalyScore: clampScore(inferredAnomaly),
    };

    return {
        analyzedUsername: username,
        followers,
        following,
        ratio,
        totalPosts,
        engagementRate,
        isPrivate,
        anomalyScore,
        hasProfilePic,
        insufficientData: finalInsufficientData,
        accountAgeDays,
        postingVelocity,
        followerGrowthPerDayProxy,
        postingRecencyDays,
        activityTimeEntropy,
        normalizedFollowerFollowingRatio,
        interactionDensity,
        commentUniquenessRatio,
        uniqueCommentUsers,
        computedFeatures,
        suspiciousBioKeywordCount,
        usernameDigitRatio,
    };
}

function extractMessageMetrics(content) {
    const payload = parseMessageContentPayload(content);
    const messages = payload.messages;
    const rawMessages = payload.rawMessages.length > 0 ? payload.rawMessages : messages;
    const incomingEvents = (Array.isArray(payload.rawMessageEvents) ? payload.rawMessageEvents : [])
        .filter((evt) => evt?.senderType === 'incoming');
    const outgoingEvents = (Array.isArray(payload.rawMessageEvents) ? payload.rawMessageEvents : [])
        .filter((evt) => evt?.senderType === 'outgoing');
    const unknownSenderEvents = (Array.isArray(payload.rawMessageEvents) ? payload.rawMessageEvents : [])
        .filter((evt) => !evt?.senderType || evt?.senderType === 'unknown');
    const useIncomingOnly = false;
    const senderScopedMessages = rawMessages;
    const senderScopedSource = 'mixed-all';
    const text = senderScopedMessages.join('\n');
    const lower = text.toLowerCase();
    const normalizedDetectionText = normalizeMessageTextForDetection(text);
    const detectionSource = `${lower}\n${normalizedDetectionText}`;
    const urgentMatches = detectionSource.match(/\b(urgent|act now|hurry|expires|asap|jaldi|turant|abhi|abhi karo|last chance|turant karo)\b/g) || [];
    const scamMatches = detectionSource.match(/\b(verify|verification|payment|reward|claim|crypto|gift|password|otp|lottery|double money|inaam|offer khatam|paisa double)\b/g) || [];
    const textLinkMatches = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
    const normalizedLinkMatches = normalizedDetectionText.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
    const linkMatches = Array.from(new Set([...textLinkMatches, ...normalizedLinkMatches]));
    const credentialKeywordMatches = detectionSource.match(/\b(password|otp|login|verification code|2fa|bank account|pin|cvv|netbanking|ifsc|aadhaar|pan|account number|bank details|code bhejo)\b/g) || [];
    const impersonationMatches = detectionSource.match(/\b(instagram support|admin|official|security team|help center|customer care|service desk|kyc team|bank support|compliance team)\b/g) || [];
    const financialPressureMatches = detectionSource.match(/\b(send money|upi|bank|wire|transfer|bitcoin|usdt|crypto wallet|processing fee|advance payment|turant payment|abhi payment|paise bhejo)\b/g) || [];
    const otpKeywordMatches = detectionSource.match(/\b(otp|verification code|2fa|one time password|security code|confirm code)\b/g) || [];
    const cryptoContextMatches = detectionSource.match(/\b(crypto|wallet|binance|exchange|usdt|bitcoin|seed phrase|metamask|trust wallet|coinbase)\b/g) || [];
    const credentialTransferMatches = detectionSource.match(/\b(send|share|forward|tell|give|provide|confirm)\s+(me\s+)?(the\s+)?(otp|code|verification code|2fa|password|seed phrase|recovery phrase|security code)\b/g) || [];
    const genericCodeRequestMatches = detectionSource.match(/\b(confirm|verify|provide|submit)\s+(your\s+)?(account code|security code|verification code|login code|code)\b/g) || [];
    const platformSwitchMatches = detectionSource.match(/\b(telegram|t\.me|whatsapp|wa\.me|signal|discord)\b/g) || [];
    const redirectionIntentMatches = detectionSource.match(/\b(continue on|message me on|chat on|dm on|switch to|move to|not secure here)\b/g) || [];
    const recruitmentScamMatches = detectionSource.match(/\b(business partners?|partner program|daily income|stable income|earn\s*\d+\+?\s*(inr|rs)?\s*(daily|per day)?|part[-\s]?time|only\s*\d+\s*[-to]{1,3}\s*\d+\s*hours?|targets?|team building|apply telegram|contact us now|serious partners?)\b/g) || [];
    const safetyNegationMatches = detectionSource.match(/\b(do not|don't|never|avoid|mat|na|nahi)\s+(share|send|give).{0,30}\b(otp|code|password|seed phrase|verification)\b/g) || [];
    const reportingContextMatches = detectionSource.match(/\b(i got a message|someone messaged me|they asked me|he said|she said|looks strange|is this scam|is this legit|have you seen this)\b/g) || [];
    const harassmentMatches = detectionSource.match(/\b(idiot|stupid|loser|worthless|shut up|moron|bastard|harass|abuse|hate you)\b/g) || [];
    const violenceThreatMatches = detectionSource.match(/\b(kill you|hurt you|beat you|attack you|you will pay|i will find you|come to your house|stab|shoot|threat)\b/g) || [];
    const sexualSolicitationMatches = detectionSource.match(/\b(nude|nudes|sex chat|sext|private pics|explicit|hookup|send pics|video sex)\b/g) || [];
    const blackmailSextortionMatches = detectionSource.match(/\b(pay me or|send money or|i will leak|i will expose|leak your photos|share your video|blackmail|sextortion|ransom)\b/g) || [];
    const selfHarmMatches = detectionSource.match(/\b(kill myself|end my life|want to die|hurt myself|self harm|suicide|can't go on|no point in living|jeena nahi|marna chahta|khud ko nuksan)\b/g) || [];
    const exclamationMatches = text.match(/!/g) || [];
    const emojiMatches = text.match(/\p{Extended_Pictographic}/gu) || [];
    const upperChars = (text.match(/[A-Z]/g) || []).length;
    const letterChars = (text.match(/[A-Za-z]/g) || []).length;
    const capsRatio = letterChars > 0 ? (upperChars / letterChars) : 0;
    const suspiciousDomainMatches = detectionSource.match(/bit\.ly|tinyurl|t\.me|wa\.me|cutt\.ly|rb\.gy|goo\.gl|is\.gd|shorturl/g) || [];
    const knownSafeDomains = new Set([
        'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com',
        'whatsapp.com', 'www.whatsapp.com', 'youtube.com', 'www.youtube.com',
        'google.com', 'www.google.com', 'linkedin.com', 'www.linkedin.com'
    ]);
    const riskyTldPattern = /\.(xyz|top|click|work|loan|gq|tk|cf|ml|ga|buzz|rest|cam)\b/i;
    const extractedDomains = [];
    for (const rawUrl of linkMatches) {
        let candidate = String(rawUrl || '').trim();
        if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
        try {
            const hostname = new URL(candidate).hostname.toLowerCase();
            if (hostname) extractedDomains.push(hostname);
        } catch {
            // ignore malformed domains
        }
    }
    const uniqueDomains = Array.from(new Set(extractedDomains));
    const unsafeDomainCount = uniqueDomains.filter((d) => !knownSafeDomains.has(d)).length;
    const riskyTldCount = uniqueDomains.filter((d) => riskyTldPattern.test(d)).length;
    const brandTyposquatPattern = /(instagr[a4]m|instagran|faceb[o0]{2}k|whatsa?p[p]?|payt[tm]|g[o0]{2}gle|micr[o0]soft|meta-?support)/i;
    const brandTyposquatCount = uniqueDomains.filter((d) => brandTyposquatPattern.test(d)).length;
    const ipDomainPattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    const ipDomainCount = uniqueDomains.filter((d) => ipDomainPattern.test(d)).length;
    const punycodeDomainCount = uniqueDomains.filter((d) => d.includes('xn--')).length;
    const suspiciousPathPattern = /(login|verify|verification|secure|wallet|kyc|reset|gift|claim|payment|account[-_]?check)/i;
    const suspiciousPathHits = linkMatches.reduce((acc, rawUrl) => (
        suspiciousPathPattern.test(String(rawUrl || '').toLowerCase()) ? acc + 1 : acc
    ), 0);
    let obfuscatedLinkSignals = linkMatches.reduce((acc, rawUrl) => {
        const candidate = String(rawUrl || '').toLowerCase();
        if (!candidate) return acc;
        if (candidate.includes('%40') || candidate.includes('@')) acc += 1;
        if (candidate.includes('login') || candidate.includes('verify') || candidate.includes('secure')) acc += 1;
        return acc;
    }, 0);
    const obfuscatedHintMatches = lower.match(/hxxps?:\/\/|hxxp:\/\/|\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+/g) || [];
    obfuscatedLinkSignals += obfuscatedHintMatches.length;
    const hasCredentialOrImpersonation = credentialKeywordMatches.length > 0 || impersonationMatches.length > 0;
    const riskyLinkEvidence =
        suspiciousDomainMatches.length > 0 ||
        riskyTldCount > 0 ||
        unsafeDomainCount > 0 ||
        ipDomainCount > 0 ||
        punycodeDomainCount > 0 ||
        obfuscatedLinkSignals > 0;
    const phishingLinkCount = linkMatches.length > 0 && hasCredentialOrImpersonation && riskyLinkEvidence ? linkMatches.length : 0;
    const broadcastMatches = detectionSource.match(/\b(limited-time opportunity|no experience required|share the details|join us|running on internet|join our team|click the link|refer and earn)\b/g) || [];
    const personalizationMatches = detectionSource.match(/\b(bro|anna|akka|ra|you|your|please|hey)\b/g) || [];
    const normalizedMessages = senderScopedMessages.map((msg) => String(msg || '').trim().toLowerCase()).filter(Boolean);
    const uniqueMessageCount = new Set(normalizedMessages).size;
    const repetitionRatio = normalizedMessages.length > 0 ? 1 - (uniqueMessageCount / normalizedMessages.length) : 0;
    let consecutiveRepeatCount = 0;
    for (let i = 1; i < normalizedMessages.length; i += 1) {
        if (normalizedMessages[i] === normalizedMessages[i - 1]) consecutiveRepeatCount += 1;
    }
    const lengths = senderScopedMessages.map((msg) => String(msg || '').length);
    const avgMessageLength = lengths.length > 0 ? lengths.reduce((sum, n) => sum + n, 0) / lengths.length : 0;
    const lengthVariance = lengths.length > 1
        ? lengths.reduce((sum, n) => sum + ((n - avgMessageLength) ** 2), 0) / lengths.length
        : 0;
    const lengthStdDev = Math.sqrt(lengthVariance);
    const shortMessageRatio = lengths.length > 0 ? (lengths.filter((n) => n > 0 && n < 12).length / lengths.length) : 0;
    const wordCounts = senderScopedMessages.map((msg) => String(msg || '').trim().split(/\s+/).filter(Boolean).length);
    const avgWordCount = wordCounts.length > 0 ? wordCounts.reduce((sum, n) => sum + n, 0) / wordCounts.length : 0;
    const complexityPenalty = avgWordCount > 0 && avgWordCount < 3 ? 6 : 0;
    const scoringTimelineEvents = useIncomingOnly
        ? incomingEvents
        : (Array.isArray(payload.rawMessageEvents) ? payload.rawMessageEvents : []);
    const timeline = scoringTimelineEvents
        .map((evt) => {
            const ts =
                Number(evt?.timestampMs) ||
                Number(evt?.timestamp) ||
                (evt?.timestampIso ? Date.parse(String(evt.timestampIso)) : NaN);
            return Number.isFinite(ts) ? ts : null;
        })
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    const interMessageSec = [];
    for (let i = 1; i < timeline.length; i += 1) {
        const delta = (timeline[i] - timeline[i - 1]) / 1000;
        if (delta > 0) interMessageSec.push(delta);
    }
    let maxBurst2Min = 0;
    let maxBurst5Min = 0;
    for (let i = 0; i < timeline.length; i += 1) {
        let twoMinCount = 1;
        let fiveMinCount = 1;
        for (let j = i + 1; j < timeline.length; j += 1) {
            const deltaMs = timeline[j] - timeline[i];
            if (deltaMs <= 120000) twoMinCount += 1;
            if (deltaMs <= 300000) fiveMinCount += 1;
            if (deltaMs > 300000) break;
        }
        if (twoMinCount > maxBurst2Min) maxBurst2Min = twoMinCount;
        if (fiveMinCount > maxBurst5Min) maxBurst5Min = fiveMinCount;
    }
    const rapidIntervals = interMessageSec.filter((sec) => sec <= 20).length;
    const rapidFireRatio = interMessageSec.length > 0 ? (rapidIntervals / interMessageSec.length) : 0;
    const nightMessages = timeline.filter((ms) => {
        const hour = new Date(ms).getHours();
        return hour >= 0 && hour < 5;
    }).length;
    const nightActivityRatio = timeline.length > 0 ? (nightMessages / timeline.length) : 0;
    const avgInterMessageSec = interMessageSec.length > 0
        ? interMessageSec.reduce((sum, n) => sum + n, 0) / interMessageSec.length
        : 0;
    const timelineCoverage = rawMessages.length > 0 ? (timeline.length / rawMessages.length) : 0;
    const incomingMessageCount = incomingEvents.length;
    const outgoingMessageCount = outgoingEvents.length;
    const unknownSenderMessageCount = unknownSenderEvents.length;
    const senderKnownTotal = incomingMessageCount + outgoingMessageCount;
    const incomingRatio = senderKnownTotal > 0 ? (incomingMessageCount / senderKnownTotal) : 0;
    const outgoingRatio = senderKnownTotal > 0 ? (outgoingMessageCount / senderKnownTotal) : 0;
    const mediaAttachmentCount = (Array.isArray(payload.rawMessageEvents) ? payload.rawMessageEvents : [])
        .filter((evt) => evt?.hasMediaAttachment === true).length;
    const incomingMediaAttachmentCount = incomingEvents.filter((evt) => evt?.hasMediaAttachment === true).length;
    const mediaOnlyIncomingCount = incomingEvents.filter((evt) => {
        const text = String(evt?.text || '').trim();
        return evt?.hasMediaAttachment === true && text.length <= 3;
    }).length;
    const stopTokens = new Set(['the', 'and', 'for', 'are', 'you', 'your', 'this', 'that', 'with', 'have', 'was', 'but', 'from']);
    const tokenizeMessage = (msg) => (
        String(msg || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !stopTokens.has(token))
    );
    let continuitySamples = 0;
    let continuityAccumulator = 0;
    for (let i = 1; i < senderScopedMessages.length; i += 1) {
        const prev = new Set(tokenizeMessage(senderScopedMessages[i - 1]));
        const curr = new Set(tokenizeMessage(senderScopedMessages[i]));
        if (prev.size === 0 || curr.size === 0) continue;
        const intersection = [...curr].filter((token) => prev.has(token)).length;
        const unionSize = new Set([...prev, ...curr]).size || 1;
        continuityAccumulator += (intersection / unionSize);
        continuitySamples += 1;
    }
    const conversationContinuity = continuitySamples > 0 ? (continuityAccumulator / continuitySamples) : 0;

    const suspiciousKeywordCount =
        urgentMatches.length +
        scamMatches.length +
        linkMatches.length +
        impersonationMatches.length +
        credentialTransferMatches.length +
        genericCodeRequestMatches.length +
        platformSwitchMatches.length +
        recruitmentScamMatches.length +
        financialPressureMatches.length +
        harassmentMatches.length +
        violenceThreatMatches.length +
        sexualSolicitationMatches.length +
        blackmailSextortionMatches.length +
        selfHarmMatches.length;
    const spamCount = (suspiciousKeywordCount > 0 || repetitionRatio > 0.45 || consecutiveRepeatCount >= 3) ? 1 : 0;
    const threatScore = clampScore(
        (urgentMatches.length * 10) +
        (scamMatches.length * 16) +
        (linkMatches.length * 8) +
        (credentialKeywordMatches.length * 14) +
        (credentialTransferMatches.length * 20) +
        (genericCodeRequestMatches.length * 12) +
        (impersonationMatches.length * 12) +
        (financialPressureMatches.length * 10) +
        ((platformSwitchMatches.length > 0 && redirectionIntentMatches.length > 0) ? 12 : 0) +
        (platformSwitchMatches.length * 4) +
        (recruitmentScamMatches.length * 10) +
        (phishingLinkCount * 15) +
        (suspiciousDomainMatches.length * 10) +
        (brandTyposquatCount * 12) +
        (suspiciousPathHits * 5) +
        (ipDomainCount * 12) +
        (punycodeDomainCount * 8) +
        (obfuscatedLinkSignals * 4) +
        (unsafeDomainCount * 6) +
        (riskyTldCount * 9) +
        (broadcastMatches.length * 4) +
        (harassmentMatches.length * 8) +
        (violenceThreatMatches.length * 20) +
        (sexualSolicitationMatches.length * 12) +
        (blackmailSextortionMatches.length * 22) +
        (selfHarmMatches.length * 24) +
        (personalizationMatches.length > 0 ? -Math.min(8, personalizationMatches.length * 2) : 0) +
        (repetitionRatio * 35) +
        (Math.min(20, consecutiveRepeatCount * 4)) +
        (shortMessageRatio * 18) +
        (Math.min(20, Math.max(0, maxBurst2Min - 3) * 4)) +
        (rapidFireRatio * 20) +
        (nightActivityRatio > 0.5 && timeline.length >= 6 ? 8 : 0) +
        (emojiMatches.length > messages.length ? 6 : 0) +
        (capsRatio > 0.35 ? 10 : 0) +
        (exclamationMatches.length >= 3 ? 8 : 0) +
        complexityPenalty
    );
    const contextualSafetyShield = clampScore(
        ((safetyNegationMatches.length > 0) ? Math.min(18, safetyNegationMatches.length * 10) : 0) +
        ((reportingContextMatches.length > 0 && credentialTransferMatches.length === 0 && phishingLinkCount === 0)
            ? Math.min(12, reportingContextMatches.length * 6)
            : 0)
    );
    const conversationPenalty = conversationContinuity < 0.1 && senderScopedMessages.length >= 6 ? 8 : 0;
    const conversationCredit = conversationContinuity >= 0.3 && broadcastMatches.length === 0 ? 6 : 0;
    const trustedConversationSignal =
        incomingRatio <= 0.55 &&
        outgoingRatio >= 0.35 &&
        conversationContinuity >= 0.3 &&
        suspiciousDomainMatches.length === 0 &&
        credentialKeywordMatches.length === 0 &&
        impersonationMatches.length === 0 &&
        financialPressureMatches.length === 0;
    const senderRolePenalty =
        incomingRatio >= 0.7 && (credentialKeywordMatches.length > 0 || suspiciousDomainMatches.length > 0 || financialPressureMatches.length > 0)
            ? 8
            : 0;
    const outgoingDominanceCredit =
        outgoingRatio >= 0.7 && incomingRatio <= 0.25 && suspiciousDomainMatches.length === 0
            ? 8
            : 0;
    const mediaRiskSignals =
        (incomingMediaAttachmentCount > 0 ? 1 : 0) +
        (mediaOnlyIncomingCount >= 2 ? 1 : 0) +
        ((incomingMediaAttachmentCount > 0 && (credentialKeywordMatches.length > 0 || suspiciousDomainMatches.length > 0 || brandTyposquatCount > 0)) ? 1 : 0);
    const mediaPenalty = mediaRiskSignals >= 2 ? 8 : (mediaRiskSignals === 1 ? 4 : 0);
    const otpCryptoComboDetected = otpKeywordMatches.length > 0 && cryptoContextMatches.length > 0;
    const conversationRiskSignalCount = [
        otpCryptoComboDetected,
        otpKeywordMatches.length > 0 && (financialPressureMatches.length > 0 || impersonationMatches.length > 0),
        credentialKeywordMatches.length > 0 && cryptoContextMatches.length > 0,
    ].filter(Boolean).length;
    const conversationRiskBoost = conversationRiskSignalCount > 0 ? Math.min(16, conversationRiskSignalCount * 6) : 0;
    let adjustedThreatScore = clampScore(
        threatScore + conversationPenalty - conversationCredit + senderRolePenalty + mediaPenalty - outgoingDominanceCredit + conversationRiskBoost - contextualSafetyShield
    );
    if (trustedConversationSignal) {
        adjustedThreatScore = clampScore(adjustedThreatScore - 6);
    }
    const scamFloorSignals =
        suspiciousDomainMatches.length +
        brandTyposquatCount +
        ipDomainCount +
        punycodeDomainCount +
        riskyTldCount +
        suspiciousPathHits +
        credentialKeywordMatches.length +
        credentialTransferMatches.length +
        financialPressureMatches.length +
        recruitmentScamMatches.length +
        ((platformSwitchMatches.length > 0 && redirectionIntentMatches.length > 0) ? 1 : 0) +
        (scamMatches.length >= 2 ? 1 : 0);
    const floorThreatScore = credentialKeywordMatches.length > 0 ? 55 : 45;
    let finalThreatScore = scamFloorSignals >= 4 ? Math.max(adjustedThreatScore, floorThreatScore) : adjustedThreatScore;
    let hardRiskRuleApplied = false;
    if (otpCryptoComboDetected && finalThreatScore < 60) {
        finalThreatScore = 60;
        hardRiskRuleApplied = true;
    }
    if (
        credentialTransferMatches.length > 0 &&
        (impersonationMatches.length > 0 || financialPressureMatches.length > 0 || cryptoContextMatches.length > 0) &&
        finalThreatScore < 70
    ) {
        finalThreatScore = 70;
        hardRiskRuleApplied = true;
    }
    if (
        recruitmentScamMatches.length >= 2 &&
        platformSwitchMatches.length > 0 &&
        financialPressureMatches.length > 0 &&
        finalThreatScore < 75
    ) {
        finalThreatScore = 75;
        hardRiskRuleApplied = true;
    }
    const strongPhishingEvidence = phishingLinkCount > 0 && (credentialKeywordMatches.length > 0 || impersonationMatches.length > 0);
    const scamSignalCount = [
        scamMatches.length >= 2,
        credentialKeywordMatches.length > 0,
        impersonationMatches.length > 0,
        financialPressureMatches.length > 0,
        suspiciousDomainMatches.length > 0 || riskyTldCount > 0,
        phishingLinkCount > 0,
    ].filter(Boolean).length;
    const scamCount = (
        finalThreatScore >= 75 ||
        (strongPhishingEvidence && scamSignalCount >= 2) ||
        scamSignalCount >= 3
    ) ? 1 : 0;
    const safetyCriticalSignalCount = violenceThreatMatches.length + blackmailSextortionMatches.length + selfHarmMatches.length;
    const safetyModerateSignalCount = harassmentMatches.length + sexualSolicitationMatches.length;

    const computedFeatures = {
        urgentCount: urgentMatches.length,
        scamKeywordCount: scamMatches.length,
        credentialKeywordCount: credentialKeywordMatches.length,
        otpKeywordCount: otpKeywordMatches.length,
        cryptoContextCount: cryptoContextMatches.length,
        credentialTransferCount: credentialTransferMatches.length,
        genericCodeRequestCount: genericCodeRequestMatches.length,
        platformSwitchCount: platformSwitchMatches.length,
        redirectionIntentCount: redirectionIntentMatches.length,
        recruitmentScamCount: recruitmentScamMatches.length,
        safetyNegationCount: safetyNegationMatches.length,
        reportingContextCount: reportingContextMatches.length,
        contextualSafetyShield,
        otpCryptoComboDetected,
        conversationRiskSignalCount,
        conversationRiskBoost,
        hardRiskRuleApplied,
        impersonationKeywordCount: impersonationMatches.length,
        financialPressureCount: financialPressureMatches.length,
        harassmentCount: harassmentMatches.length,
        violenceThreatCount: violenceThreatMatches.length,
        sexualSolicitationCount: sexualSolicitationMatches.length,
        blackmailSextortionCount: blackmailSextortionMatches.length,
        selfHarmCount: selfHarmMatches.length,
        linkCount: linkMatches.length,
        phishingLinkCount,
        capsRatio: Number(capsRatio.toFixed(3)),
        exclamationCount: exclamationMatches.length,
        suspiciousDomainCount: suspiciousDomainMatches.length,
        brandTyposquatCount,
        suspiciousPathHits,
        domainCount: uniqueDomains.length,
        unsafeDomainCount,
        riskyTldCount,
        ipDomainCount,
        punycodeDomainCount,
        obfuscatedLinkSignals,
        broadcastHits: broadcastMatches.length,
        personalizationHits: personalizationMatches.length,
        conversationContinuity: Number(conversationContinuity.toFixed(3)),
        repetitionRatio: Number(repetitionRatio.toFixed(3)),
        consecutiveRepeatCount,
        uniqueMessageCount,
        avgMessageLength: Number(avgMessageLength.toFixed(2)),
        lengthStdDev: Number(lengthStdDev.toFixed(2)),
        shortMessageRatio: Number(shortMessageRatio.toFixed(3)),
        avgWordCount: Number(avgWordCount.toFixed(2)),
        emojiCount: emojiMatches.length,
        timelineCoverage: Number(timelineCoverage.toFixed(3)),
        avgInterMessageSec: Number(avgInterMessageSec.toFixed(2)),
        maxBurst2Min,
        maxBurst5Min,
        rapidFireRatio: Number(rapidFireRatio.toFixed(3)),
        nightActivityRatio: Number(nightActivityRatio.toFixed(3)),
        senderScopedSource,
        incomingMessageCount,
        outgoingMessageCount,
        unknownSenderMessageCount,
        incomingRatio: Number(incomingRatio.toFixed(3)),
        outgoingRatio: Number(outgoingRatio.toFixed(3)),
        mediaAttachmentCount,
        incomingMediaAttachmentCount,
        mediaOnlyIncomingCount,
        trustedConversationSignal,
        mediaRiskSignals,
        safetyCriticalSignalCount,
        safetyModerateSignalCount,
    };

    return {
        totalMessages: messages.length || 1,
        spamCount,
        scamCount,
        suspiciousKeywordCount,
        threatScore: finalThreatScore,
        phishingLinkCount,
        credentialKeywordCount: credentialKeywordMatches.length,
        harassmentCount: harassmentMatches.length,
        violenceThreatCount: violenceThreatMatches.length,
        sexualSolicitationCount: sexualSolicitationMatches.length,
        blackmailSextortionCount: blackmailSextortionMatches.length,
        selfHarmCount: selfHarmMatches.length,
        repetitionRatio: Number(repetitionRatio.toFixed(3)),
        consecutiveRepeatCount,
        timelineCoverage: Number(timelineCoverage.toFixed(3)),
        rapidFireRatio: Number(rapidFireRatio.toFixed(3)),
        nightActivityRatio: Number(nightActivityRatio.toFixed(3)),
        computedFeatures,
    };
}

async function storeBehaviorAnalysis(userId, profileMetrics, messageMetrics, heuristics) {
    const postingPattern = (profileMetrics?.totalPosts ?? 0) > 40 ? 'high' : (profileMetrics?.totalPosts ?? 0) < 3 ? 'low' : 'normal';
    const followerGrowthSpike = (profileMetrics?.ratio ?? 0) > 10 ? 1 : 0;
    const repeatedMessagePatternCount = Math.max(
        Number(messageMetrics?.suspiciousKeywordCount || 0),
        Number(messageMetrics?.consecutiveRepeatCount || 0),
        Math.round(Number(messageMetrics?.repetitionRatio || 0) * 10),
        Math.round(Number(messageMetrics?.rapidFireRatio || 0) * 10)
    );
    const unusualActivityTimingFlag =
        ((messageMetrics?.threatScore ?? 0) >= 70 || (messageMetrics?.nightActivityRatio ?? 0) >= 0.6)
            ? 1
            : 0;
    const anomalyScore = clampScore(
        heuristics?.behavioralRisk ??
        ((profileMetrics?.anomalyScore || 0) * 0.4 + (messageMetrics?.threatScore || 0) * 0.6)
    );

    await runDb(
        `INSERT INTO behavior_analysis
            (user_id, posting_pattern, follower_growth_spike, repeated_message_pattern_count, unusual_activity_timing_flag, anomaly_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [userId, postingPattern, followerGrowthSpike, repeatedMessagePatternCount, unusualActivityTimingFlag, anomalyScore]
    );

    return { postingPattern, followerGrowthSpike, repeatedMessagePatternCount, unusualActivityTimingFlag, anomalyScore };
}

async function insertFinalPrediction(userId, data) {
    const created = await runDb(
        `INSERT INTO final_predictions
            (user_id, risk_score, risk_level, confidence_score, profile_score, message_score, behavior_score, engagement_score, explanation_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            userId,
            clampScore(data.riskScore),
            toRiskLevel(clampScore(data.riskScore)),
            clampScore(data.confidenceScore ?? 0),
            clampScore(data.profileScore ?? 0),
            clampScore(data.messageScore ?? 0),
            clampScore(data.behaviorScore ?? 0),
            clampScore(data.engagementScore ?? 0),
            JSON.stringify({
                contentType: data.contentType,
                content: data.content,
                flags: data.flags || [],
                recommendations: data.recommendations || [],
                classificationTag: data.classificationTag || null,
                heuristics: data.heuristics || null,
                source: data.source || 'server',
            }),
        ]
    );
    return created.lastID;
}

// Create a lightweight analysis record (used by the client)
app.post('/api/analyses', authenticateToken, async (req, res) => {
    const validation = analysisSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ message: 'Invalid request body', errors: validation.error.errors });
    }

    const { contentType, content, url } = validation.data;
    const userId = req.user.userId;

    try {
        const messageMetrics = contentType === 'message' ? extractMessageMetrics(content) : null;
        const profileMetrics = contentType === 'profile' ? extractProfileMetrics(content, null) : null;
        let predictionScore = 0;
        let mlModelUsed = 'heuristics-only';
        try {
            if (contentType === 'message') {
                const prediction = await getMessagePrediction(content);
                predictionScore = prediction.riskScore;
                mlModelUsed = prediction.modelUsed;
            } else {
                const prediction = await getProfilePrediction(content);
                predictionScore = prediction.riskScore;
                mlModelUsed = prediction.modelUsed;
            }
        } catch (predictionError) {
            // Fall back to deterministic scoring so analysis is still persisted when ML runtime is unavailable.
            predictionScore = clampScore(
                contentType === 'message'
                    ? (messageMetrics?.threatScore ?? 0)
                    : (profileMetrics?.anomalyScore ?? 0)
            );
        }
        const profileRiskGuards = contentType === 'profile' && profileMetrics
            ? applyProfileRiskGuards(Math.max(predictionScore, profileMetrics?.anomalyScore ?? 0), profileMetrics)
            : null;
        const effectiveRiskScore = clampScore(
            contentType === 'message'
                ? (() => {
                    const modelRisk = clampScore(predictionScore);
                    const heuristicRisk = clampScore(messageMetrics?.threatScore ?? 0);
                    const blended = Math.round((modelRisk * 0.45) + (heuristicRisk * 0.55));
                    // Keep headroom for clearly dangerous signals, but avoid hard jumps to 100 on heuristics alone.
                    if (heuristicRisk >= 90 && modelRisk >= 55) return Math.max(blended, 80);
                    return blended;
                })()
                : (profileRiskGuards?.riskScore ?? Math.max(predictionScore, profileMetrics?.anomalyScore ?? 0))
        );
        let confidenceScore = mlModelUsed === 'heuristics-only' ? 65 : 85;
        if (contentType === 'message' && messageMetrics) {
            const modelRisk = clampScore(predictionScore);
            const heuristicRisk = clampScore(messageMetrics.threatScore || 0);
            const disagreement = Math.abs(modelRisk - heuristicRisk);
            const sampleQuality =
                ((Number(messageMetrics.totalMessages || 0) >= 20) ? 0.35 : (Number(messageMetrics.totalMessages || 0) >= 8 ? 0.2 : 0.1)) +
                ((Number(messageMetrics.timelineCoverage || 0) >= 0.6) ? 0.25 : (Number(messageMetrics.timelineCoverage || 0) >= 0.25 ? 0.15 : 0.05)) +
                ((Number(messageMetrics.computedFeatures?.unsafeDomainCount || 0) > 0 || Number(messageMetrics.computedFeatures?.suspiciousDomainCount || 0) > 0) ? 0.2 : 0.1) +
                ((Number(messageMetrics.computedFeatures?.repetitionRatio || 0) > 0.35) ? 0.2 : 0.1);
            const agreementPenalty =
                disagreement > 45 ? 28 :
                disagreement > 30 ? 18 :
                disagreement > 18 ? 10 :
                0;
            confidenceScore = clampScore(
                Math.round(
                    (mlModelUsed === 'heuristics-only' ? 48 : 62) +
                    (sampleQuality * 30) -
                    agreementPenalty
                )
            );
        }
        if (contentType === 'profile' && profileRiskGuards?.insufficientData) {
            confidenceScore = Math.min(confidenceScore, 40);
        }

        if (profileMetrics) {
            const profileHeuristicsPayload = {
                source: 'server',
                computedFeatures: profileMetrics.computedFeatures,
            };
            await runDb(
                `INSERT INTO profile_analysis
                    (user_id, analyzed_username, followers_count, following_count, ratio, total_posts, engagement_rate, is_private, suspicious_indicator_flag, anomaly_score, heuristics, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                    userId,
                    profileMetrics.analyzedUsername || null,
                    profileMetrics.followers,
                    profileMetrics.following,
                    profileMetrics.ratio,
                    profileMetrics.totalPosts,
                    profileMetrics.engagementRate,
                    profileMetrics.isPrivate ? 1 : 0,
                    effectiveRiskScore >= 70 ? 1 : 0,
                    effectiveRiskScore,
                    JSON.stringify(profileHeuristicsPayload),
                ]
            );
        }

        if (messageMetrics) {
            const messageHeuristicsPayload = {
                source: 'server',
                mlModelUsed,
                mlRiskScore: predictionScore,
                computedFeatures: messageMetrics.computedFeatures,
            };
            await runDb(
                `INSERT INTO message_analysis
                    (user_id, total_messages, spam_count, scam_count, suspicious_keyword_count, threat_score, heuristics, last_analyzed_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
                [
                    userId,
                    messageMetrics.totalMessages,
                    messageMetrics.spamCount,
                    messageMetrics.scamCount,
                    messageMetrics.suspiciousKeywordCount,
                    messageMetrics.threatScore,
                    JSON.stringify(messageHeuristicsPayload),
                ]
            );
        }

        const behavior = await storeBehaviorAnalysis(userId, profileMetrics, messageMetrics, null);
        const profileMetricsForClassification = contentType === 'profile'
            ? {
                ...(profileMetrics || {}),
                insufficientData: profileRiskGuards?.insufficientData ?? profileMetrics?.insufficientData,
            }
            : profileMetrics;
        const messageClassModel = contentType === 'message'
            ? computeMessageClassScores(messageMetrics, effectiveRiskScore)
            : null;
        const classificationTag = deriveClassificationTag(contentType, profileMetricsForClassification, messageMetrics, effectiveRiskScore);
        const recommendations = contentType === 'message'
            ? buildMessageRecommendations(classificationTag, effectiveRiskScore)
            : (contentType === 'profile' && profileRiskGuards?.insufficientData)
                ? ['Insufficient profile evidence. Collect more interaction and activity signals before concluding risk.']
                : effectiveRiskScore >= 70
                    ? [
                        'Enable two-factor authentication immediately.',
                        'Review recent logins and revoke unknown sessions.',
                        'Avoid links and payment requests from untrusted accounts.',
                    ]
                    : effectiveRiskScore >= 40
                        ? [
                            'Review suspicious messages and block unknown senders.',
                            'Strengthen privacy settings and limit account visibility.',
                        ]
                        : ['Maintain current security hygiene and monitor unusual activity.'];

        const analysisFlags = buildMessageFlags(messageMetrics);

        const analysisId = await insertFinalPrediction(userId, {
            riskScore: effectiveRiskScore,
            confidenceScore,
            profileScore: profileMetrics?.anomalyScore || 0,
            messageScore: messageMetrics?.threatScore || 0,
            behaviorScore: behavior.anomalyScore,
            engagementScore: profileMetrics?.engagementRate || 0,
            contentType,
            content: content || url || '',
            flags: analysisFlags,
            classificationTag,
            recommendations,
            source: 'server',
            heuristics: {
                mlModelUsed,
                mlRiskScore: predictionScore,
                profile: profileMetrics?.computedFeatures || null,
                profileRiskGuards: profileRiskGuards || null,
                message: messageMetrics?.computedFeatures || null,
                messageCategorySignals: messageMetrics ? {
                    selfHarmCount: Number(messageMetrics.selfHarmCount || 0),
                    violenceThreatCount: Number(messageMetrics.violenceThreatCount || 0),
                    blackmailSextortionCount: Number(messageMetrics.blackmailSextortionCount || 0),
                    sexualSolicitationCount: Number(messageMetrics.sexualSolicitationCount || 0),
                    harassmentCount: Number(messageMetrics.harassmentCount || 0),
                    classScores: messageClassModel?.classScores || null,
                    mixedRisk: Boolean(messageClassModel?.mixed || false),
                } : null,
                messageReport: messageMetrics ? {
                    totalMessages: Number(messageMetrics.totalMessages || 0),
                    finalMessageRiskScore: effectiveRiskScore,
                    heuristicThreatScore: clampScore(messageMetrics.threatScore || 0),
                    mlThreatScore: clampScore(predictionScore || 0),
                    phishingLinkCount: Number(messageMetrics.phishingLinkCount || 0),
                    credentialKeywordCount: Number(messageMetrics.credentialKeywordCount || 0),
                    unsafeDomainCount: Number(messageMetrics.computedFeatures?.unsafeDomainCount || 0),
                    mediaRiskSignals: Number(messageMetrics.computedFeatures?.mediaRiskSignals || 0),
                    senderScopedSource: String(messageMetrics.computedFeatures?.senderScopedSource || 'mixed'),
                    classScores: messageClassModel?.classScores || null,
                    classTop: messageClassModel?.topClass || null,
                    classMargin: Number(messageClassModel?.margin || 0),
                    mixedRisk: Boolean(messageClassModel?.mixed || false),
                } : null,
            },
        });

        res.status(201).json({ id: analysisId, explanation: content || url || '' });
    } catch (error) {
        logError('api.analyses.create', error, {
            requestId: req.requestId || null,
            userId: req.user?.userId || null,
            contentType: req.body?.contentType || null,
        });
        res.status(500).json({ message: 'Failed to get prediction', error: String(error?.message || error) });
    }
});

app.post('/api/analyses/client', authenticateToken, async (req, res) => {
    const validation = clientAnalysisSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ message: 'Invalid request body', errors: validation.error.errors });
    }

    const { contentType, content, heuristics } = validation.data;
    const userId = req.user.userId;

    try {
        if (contentType === 'message') {
            const messageMetrics = extractMessageMetrics(content);
            const clientMessage = normalizeClientMessageHeuristics(heuristics);
            const serverThreatScore = clampScore(messageMetrics.threatScore || 0);
            const clientThreatScore = clampScore(clientMessage.overallRisk || 0);
            const finalMessageRiskScore = clampScore(Math.round((serverThreatScore * 0.65) + (clientThreatScore * 0.35)));
            const messageClassModel = computeMessageClassScores(messageMetrics, finalMessageRiskScore);
            const classificationTag = deriveClassificationTag('message', null, messageMetrics, finalMessageRiskScore);
            const messageFlags = buildMessageFlags(messageMetrics);
            const recommendations = buildMessageRecommendations(classificationTag, finalMessageRiskScore);
            const rawConfidenceScore = clampScore(Math.round(
                45 +
                (Number(messageMetrics.totalMessages || 0) >= 12 ? 15 : 8) +
                (Number(messageMetrics.timelineCoverage || 0) >= 0.5 ? 12 : 6) +
                (Math.abs(serverThreatScore - clientThreatScore) <= 20 ? 10 : 0) +
                ((clientMessage.evidenceQuality || 0) * 0.18)
            ));
            const confidenceConflict =
                finalMessageRiskScore < 40 &&
                (
                    Number(messageMetrics.computedFeatures?.otpCryptoComboDetected || 0) > 0 ||
                    (
                        Number(messageMetrics.computedFeatures?.credentialKeywordCount || 0) > 0 &&
                        (
                            Number(messageMetrics.computedFeatures?.cryptoContextCount || 0) > 0 ||
                            Number(messageMetrics.computedFeatures?.financialPressureCount || 0) > 0 ||
                            Number(messageMetrics.computedFeatures?.impersonationKeywordCount || 0) > 0
                        )
                    )
                );
            const criticalTagSet = new Set(['self-harm-risk', 'violent-threat', 'sextortion-blackmail', 'hacker-risk', 'phishing-risk', 'scam', 'mixed-risk']);
            const requiresServerConfirmation =
                finalMessageRiskScore >= 70 ||
                criticalTagSet.has(String(classificationTag || '').toLowerCase());
            let confidenceScore = requiresServerConfirmation
                ? Math.min(rawConfidenceScore, 72)
                : rawConfidenceScore;
            if (confidenceConflict) {
                confidenceScore = Math.min(confidenceScore, 45);
            }
            if (requiresServerConfirmation) {
                messageFlags.push('Client-side verdict is provisional; run deep server verification for final action.');
            }
            if (confidenceConflict) {
                messageFlags.push('Risk-confidence conflict detected: suspicious credential/crypto cues with low computed risk.');
            }

            await runDb(
                `INSERT INTO message_analysis
                    (user_id, total_messages, spam_count, scam_count, suspicious_keyword_count, threat_score, heuristics, last_analyzed_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
                [
                    userId,
                    messageMetrics.totalMessages,
                    messageMetrics.spamCount,
                    messageMetrics.scamCount,
                    messageMetrics.suspiciousKeywordCount,
                    finalMessageRiskScore,
                    JSON.stringify({
                        source: 'client',
                        scoring: {
                            serverThreatScore,
                            clientThreatScore,
                            blendWeightServer: 0.65,
                            blendWeightClient: 0.35,
                        },
                        clientHeuristics: heuristics,
                        computedFeatures: messageMetrics.computedFeatures,
                    }),
                ]
            );

            const behavior = await storeBehaviorAnalysis(userId, null, { ...messageMetrics, threatScore: finalMessageRiskScore }, heuristics);
            const analysisId = await insertFinalPrediction(userId, {
                riskScore: finalMessageRiskScore,
                confidenceScore,
                profileScore: 0,
                messageScore: finalMessageRiskScore,
                behaviorScore: behavior.anomalyScore,
                engagementScore: 0,
                contentType,
                content,
                flags: messageFlags,
                classificationTag,
                recommendations,
                heuristics: {
                    source: 'client',
                    requiresServerConfirmation,
                    message: messageMetrics.computedFeatures || null,
                    messageCategorySignals: {
                        selfHarmCount: Number(messageMetrics.selfHarmCount || 0),
                        violenceThreatCount: Number(messageMetrics.violenceThreatCount || 0),
                        blackmailSextortionCount: Number(messageMetrics.blackmailSextortionCount || 0),
                        sexualSolicitationCount: Number(messageMetrics.sexualSolicitationCount || 0),
                        harassmentCount: Number(messageMetrics.harassmentCount || 0),
                        classScores: messageClassModel?.classScores || null,
                        mixedRisk: Boolean(messageClassModel?.mixed || false),
                    },
                    clientMessageHeuristics: heuristics,
                    messageReport: {
                        totalMessages: Number(messageMetrics.totalMessages || 0),
                        evidenceQuality: clientMessage.evidenceQuality,
                        serverThreatScore,
                        clientThreatScore,
                        finalMessageRiskScore,
                        phishingLinkCount: Number(messageMetrics.phishingLinkCount || 0),
                        credentialKeywordCount: Number(messageMetrics.credentialKeywordCount || 0),
                        unsafeDomainCount: Number(messageMetrics.computedFeatures?.unsafeDomainCount || 0),
                        mediaRiskSignals: Number(messageMetrics.computedFeatures?.mediaRiskSignals || 0),
                        senderScopedSource: String(messageMetrics.computedFeatures?.senderScopedSource || 'mixed'),
                        classScores: messageClassModel?.classScores || null,
                        classTop: messageClassModel?.topClass || null,
                        classMargin: Number(messageClassModel?.margin || 0),
                        mixedRisk: Boolean(messageClassModel?.mixed || false),
                    },
                },
                source: 'client',
            });

            return res.status(201).json({ id: analysisId });
        }

        const profileMetrics = extractProfileMetrics(content, heuristics);
        let profileModelScore = profileMetrics.anomalyScore;
        let profileModelUsed = 'heuristics-only';
        try {
            const profilePrediction = await getProfilePrediction(content);
            profileModelScore = clampScore(Math.max(profileModelScore, profilePrediction.riskScore));
            profileModelUsed = profilePrediction.modelUsed;
        } catch (predictionError) {
            // Keep heuristic-only path if model runtime is unavailable.
        }
        const calibration = calibrateProfileRiskScore(profileModelScore, profileMetrics);
        const profileRiskGuards = applyProfileRiskGuards(calibration.calibratedRiskScore, profileMetrics);
        const finalProfileRiskScore = profileRiskGuards.riskScore;
        const classificationTag = deriveClassificationTag(
            'profile',
            { ...profileMetrics, insufficientData: profileRiskGuards.insufficientData },
            null,
            finalProfileRiskScore
        );
        const separation = Math.abs((calibration.calibratedProb * 2) - 1); // 0 near 0.5, 1 near extremes
        const modelConfidence = profileRiskGuards.insufficientData
            ? 35
            : clampScore(Math.round((35 + (40 * calibration.dataQuality) + (25 * separation))));
        await runDb(
            `INSERT INTO profile_analysis
                (user_id, analyzed_username, followers_count, following_count, ratio, total_posts, engagement_rate, is_private, suspicious_indicator_flag, anomaly_score, heuristics, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                    userId,
                    profileMetrics.analyzedUsername || null,
                    profileMetrics.followers,
                    profileMetrics.following,
                    profileMetrics.ratio,
                    profileMetrics.totalPosts,
                    profileMetrics.engagementRate,
                    profileMetrics.isPrivate ? 1 : 0,
                    finalProfileRiskScore >= 70 ? 1 : 0,
                    finalProfileRiskScore,
                    JSON.stringify({
                        ...heuristics,
                        mlModelUsed: profileModelUsed,
                        mlRiskScore: profileModelScore,
                        calibratedRiskScore: finalProfileRiskScore,
                        calibratedProbability: calibration.calibratedProb,
                        calibrationDataQuality: calibration.dataQuality,
                        computedFeatures: profileMetrics.computedFeatures,
                    }),
                ]
        );

        const behavior = await storeBehaviorAnalysis(userId, profileMetrics, null, heuristics);
        const recommendations = profileRiskGuards.insufficientData
            ? ['Insufficient profile evidence. Collect recent media, engagement, and interaction samples before final labeling.']
            : finalProfileRiskScore >= 70
                ? ['High bot-risk profile detected. Limit interactions and verify account identity.']
                : finalProfileRiskScore >= 40
                    ? ['Moderate profile risk detected. Continue monitoring content and engagement patterns.']
                    : ['Profile appears low risk from client-side heuristics.'];

        const analysisId = await insertFinalPrediction(userId, {
            riskScore: finalProfileRiskScore,
            confidenceScore: modelConfidence,
            profileScore: clampScore(
                heuristics?.structuralScore ??
                heuristics?.structuralRisk ??
                (100 - profileMetrics.anomalyScore)
            ),
            messageScore: 0,
            behaviorScore: clampScore(heuristics?.behavioralRisk ?? behavior.anomalyScore),
            engagementScore: profileMetrics.engagementRate,
            contentType,
            content,
            flags: (heuristics?.bioRisk?.detectedKeywords || []).map((k) => `Keyword: ${k}`),
            classificationTag,
            recommendations,
            heuristics: {
                ...heuristics,
                mlModelUsed: profileModelUsed,
                mlRiskScore: profileModelScore,
                calibratedRiskScore: finalProfileRiskScore,
                calibratedProbability: calibration.calibratedProb,
                calibrationDataQuality: calibration.dataQuality,
                profileRiskGuards,
                computedFeatures: profileMetrics.computedFeatures,
            },
            source: 'client',
        });

        res.status(201).json({ id: analysisId });
    } catch (error) {
        logError('api.analyses.client.create', error, {
            requestId: req.requestId || null,
            userId: req.user?.userId || null,
            contentType: req.body?.contentType || null,
        });
        res.status(500).json({ message: 'Failed to persist client analysis', error: error.message || error });
    }
});

// List analyses
app.get('/api/analyses', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow);
    try {
        const rows = await allDb(
            `SELECT * FROM final_predictions WHERE user_id = ?${timeFilter.clause} ORDER BY created_at DESC`,
            [userId, ...timeFilter.params]
        );
        const mapped = rows.map((row) => {
            const details = safeJsonParse(row.explanation_summary) || {};
            return {
                id: row.id,
                userId: row.user_id,
                contentType: details.contentType || 'message',
                content: details.content || '',
                riskScore: clampScore(row.risk_score),
                flags: Array.isArray(details.flags) ? details.flags : [],
                explanation: details.content || '',
                createdAt: row.created_at,
                heuristics: details.heuristics || undefined,
                structuralScore: row.profile_score,
                structuralRisk: clampScore(100 - row.profile_score),
                contentRisk: row.message_score,
                behavioralRisk: row.behavior_score,
                preliminaryRisk: row.risk_score,
                modelConfidence: row.confidence_score,
                riskClassification: details.classificationTag || row.risk_level,
            };
        });
        res.json(mapped);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch analyses', error: err.message });
    }
});

app.get('/api/accounts/:accountHandle/final-message-verdict', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const selectedWindow = normalizeWindow(req.query.window);
    const timeFilter = getTimeFilter(selectedWindow);
    const requestedHandle = normalizeAccountHandle(req.params.accountHandle);
    const maxRows = Math.min(500, Math.max(20, Number(req.query.limit || 200)));

    try {
        const rows = await allDb(
            `SELECT id, risk_score, created_at, explanation_summary
             FROM final_predictions
             WHERE user_id = ?${timeFilter.clause}
             ORDER BY created_at DESC
             LIMIT ?`,
            [userId, ...timeFilter.params, maxRows]
        );

        const messageRows = (Array.isArray(rows) ? rows : [])
            .map((row) => {
                const details = safeJsonParse(row.explanation_summary) || {};
                const contentType = String(details.contentType || '').toLowerCase();
                if (contentType !== 'message') return null;
                const messageSummary = extractMessageSummary(details.content);
                const conversationName = String(messageSummary.conversationName || '').trim();
                const handle = normalizeAccountHandle(conversationName);
                return {
                    id: row.id,
                    riskScore: clampScore(row.risk_score),
                    createdAt: row.created_at,
                    classificationTag: String(details.classificationTag || '').trim().toLowerCase(),
                    conversationName,
                    normalizedHandle: handle,
                    flags: Array.isArray(details.flags) ? details.flags : [],
                };
            })
            .filter(Boolean);

        const filtered = messageRows.filter((row) => {
            if (requestedHandle === 'all' || requestedHandle === '*') return true;
            if (!requestedHandle) return false;
            return row.normalizedHandle === requestedHandle;
        });

        if (filtered.length === 0) {
            return res.status(404).json({
                message: 'No message analyses found for this account handle in the selected window.',
                accountHandle: requestedHandle || null,
                window: selectedWindow,
            });
        }

        const nowMs = Date.now();
        let totalWeight = 0;
        let weightedRiskSum = 0;
        let scamEvidence = 0;
        let botEvidence = 0;
        let spamEvidence = 0;
        const tagCounts = {};
        const recentSignals = [];

        for (const item of filtered) {
            const tsMs = Date.parse(String(item.createdAt || ''));
            const ageDays = Number.isFinite(tsMs) ? Math.max(0, (nowMs - tsMs) / 86400000) : 30;
            const recencyWeight = Math.max(0.25, Math.exp(-ageDays / 7));
            totalWeight += recencyWeight;
            weightedRiskSum += (item.riskScore * recencyWeight);

            const tag = item.classificationTag || 'unknown';
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;

            const isScamLike = ['scam', 'hacker-risk', 'sextortion-blackmail', 'violent-threat', 'self-harm-risk'].includes(tag);
            const isBotLike = tag === 'bot';
            const isSpamLike = ['suspicious-message', 'abusive-harassment', 'sexual-solicitation'].includes(tag);
            if (isScamLike) scamEvidence += 1;
            if (isBotLike) botEvidence += 1;
            if (isSpamLike) spamEvidence += 1;

            if (recentSignals.length < 5) {
                recentSignals.push({
                    id: item.id,
                    createdAt: item.createdAt,
                    riskScore: item.riskScore,
                    classificationTag: tag,
                    flags: item.flags.slice(0, 3),
                });
            }
        }

        const weightedRisk = totalWeight > 0 ? clampScore(Math.round(weightedRiskSum / totalWeight)) : 0;
        const aggregate = { weightedRisk, scamEvidence, botEvidence, spamEvidence, sampleSize: filtered.length };
        const verdict = deriveAccountVerdictFromAggregation(aggregate);
        const confidenceBase = clampScore(Math.round(
            45 +
            Math.min(25, filtered.length * 3) +
            (scamEvidence > 0 ? 10 : 0) +
            (botEvidence > 0 ? 8 : 0) +
            (spamEvidence > 0 ? 6 : 0)
        ));
        const confidence = verdict.mixed ? Math.max(30, confidenceBase - 25) : confidenceBase;

        const topReasons = [];
        if (scamEvidence > 0) topReasons.push(`Scam-like evidence found in ${scamEvidence} recent message analyses.`);
        if (botEvidence > 0) topReasons.push(`Automation/bot evidence found in ${botEvidence} recent message analyses.`);
        if (spamEvidence > 0) topReasons.push(`Spam/suspicious evidence found in ${spamEvidence} recent message analyses.`);
        topReasons.push(`Recency-weighted account risk score is ${weightedRisk}%.`);
        if (verdict.mixed && verdict.mixedReason) topReasons.unshift(verdict.mixedReason);

        return res.json({
            accountHandle: requestedHandle,
            displayConversationName: filtered[0]?.conversationName || null,
            window: selectedWindow,
            sampleSize: filtered.length,
            weightedRiskScore: weightedRisk,
            finalLabel: verdict.finalLabel, // one of scam/bot/spam/human/mixed-risk
            verdictMode: verdict.verdictMode,
            mixed: verdict.mixed,
            mixedReason: verdict.mixedReason,
            confidence,
            evidence: {
                scamEvidence,
                botEvidence,
                spamEvidence,
                tagCounts,
                labelDistribution: verdict.distribution,
            },
            topReasons: topReasons.slice(0, 4),
            recentSignals,
        });
    } catch (err) {
        logError('api.accounts.final-message-verdict', err, {
            requestId: req.requestId || null,
            userId: req.user?.userId || null,
            accountHandle: req.params?.accountHandle || null,
            window: req.query?.window || null,
        });
        res.status(500).json({ message: 'Failed to compute final message verdict', error: err.message });
    }
});

app.get('/api/evaluation/messages/categories', authenticateToken, async (req, res) => {
    const datasetPath = path.resolve(__dirname, '..', 'messagedatasets', 'message_category_test_cases.json');
    try {
        if (!fs.existsSync(datasetPath)) {
            return res.status(404).json({ message: 'Category test dataset not found.', datasetPath });
        }

        const raw = fs.readFileSync(datasetPath, 'utf-8');
        const dataset = JSON.parse(raw);
        if (!Array.isArray(dataset) || dataset.length === 0) {
            return res.status(400).json({ message: 'Category test dataset is empty or invalid.', datasetPath });
        }

        const labels = new Set();
        const results = [];
        const confusion = {};

        for (const entry of dataset) {
            const expectedTag = String(entry?.expectedTag || entry?.category || '').trim().toLowerCase();
            const messages = Array.isArray(entry?.messages)
                ? entry.messages.map((msg) => String(msg || '').trim()).filter(Boolean)
                : [];
            if (!expectedTag || messages.length === 0) continue;

            labels.add(expectedTag);
            const content = { messages, rawMessages: messages, rawMessageEvents: [] };
            const messageMetrics = extractMessageMetrics(content);
            const riskScore = clampScore(messageMetrics.threatScore || 0);
            const predictedTag = String(
                deriveClassificationTag('message', null, messageMetrics, riskScore) || 'unknown'
            ).toLowerCase();
            labels.add(predictedTag);

            if (!confusion[expectedTag]) confusion[expectedTag] = {};
            confusion[expectedTag][predictedTag] = Number(confusion[expectedTag][predictedTag] || 0) + 1;

            results.push({
                category: String(entry?.category || expectedTag),
                expectedTag,
                predictedTag,
                riskScore,
                matched: expectedTag === predictedTag,
                messageCount: messages.length,
                severity: String(entry?.severity || 'unknown'),
            });
        }

        const labelList = Array.from(labels);
        const perCategory = {};
        let macroF1Accumulator = 0;

        for (const label of labelList) {
            let tp = 0;
            let fp = 0;
            let fn = 0;

            for (const expected of Object.keys(confusion)) {
                const row = confusion[expected] || {};
                for (const predicted of Object.keys(row)) {
                    const count = Number(row[predicted] || 0);
                    if (expected === label && predicted === label) tp += count;
                    else if (expected !== label && predicted === label) fp += count;
                    else if (expected === label && predicted !== label) fn += count;
                }
            }

            const precision = safeDivide(tp, tp + fp);
            const recall = safeDivide(tp, tp + fn);
            const f1 = (precision + recall) > 0 ? ((2 * precision * recall) / (precision + recall)) : 0;
            macroF1Accumulator += f1;
            perCategory[label] = {
                tp, fp, fn,
                precision: Number(precision.toFixed(4)),
                recall: Number(recall.toFixed(4)),
                f1: Number(f1.toFixed(4)),
            };
        }

        const total = results.length;
        const correct = results.filter((r) => r.matched).length;
        const accuracy = safeDivide(correct, total);
        const macroF1 = labelList.length > 0 ? (macroF1Accumulator / labelList.length) : 0;

        return res.json({
            datasetPath,
            evaluatedAt: new Date().toISOString(),
            totalCases: total,
            correctCases: correct,
            accuracy: Number(accuracy.toFixed(4)),
            macroF1: Number(macroF1.toFixed(4)),
            labels: labelList,
            perCategory,
            confusionMatrix: confusion,
            caseResults: results,
        });
    } catch (err) {
        logError('api.evaluation.messages.categories', err, {
            requestId: req.requestId || null,
            userId: req.user?.userId || null,
        });
        return res.status(500).json({ message: 'Failed to evaluate message categories', error: err.message });
    }
});

// Get analysis by id
app.get('/api/analyses/:id', authenticateToken, async (req, res) => {
    const id = req.params.id;
    const userId = req.user.userId;
    try {
        const row = await getDb(`SELECT * FROM final_predictions WHERE id = ? AND user_id = ?`, [id, userId]);
        if (!row) return res.status(404).json({ message: 'Analysis not found' });
        const details = safeJsonParse(row.explanation_summary) || {};
        res.json({
            id: row.id,
            userId: row.user_id,
            contentType: details.contentType || 'message',
            content: details.content || '',
            riskScore: clampScore(row.risk_score),
            flags: Array.isArray(details.flags) ? details.flags : [],
            explanation: details.content || '',
            createdAt: row.created_at,
            heuristics: details.heuristics || undefined,
            structuralScore: row.profile_score,
            structuralRisk: clampScore(100 - row.profile_score),
            contentRisk: row.message_score,
            behavioralRisk: row.behavior_score,
            preliminaryRisk: row.risk_score,
            modelConfidence: row.confidence_score,
            riskClassification: details.classificationTag || row.risk_level,
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch analysis', error: err.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
