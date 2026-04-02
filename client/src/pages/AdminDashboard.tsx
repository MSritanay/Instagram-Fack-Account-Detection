import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileText, LogOut, RefreshCw, ShieldAlert, Users } from 'lucide-react';
import './AdminDashboard.css';
import { clearAdminToken, getAdminToken } from '../lib/token-store';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000';

type AdminStats = {
    totalUsers: number;
    totalAnalyses: number;
    highRiskCount: number;
    avgRiskScore: number;
    selectedWindow?: string;
};

type AdminUser = {
    id: number;
    username: string;
    email: string;
    full_name?: string;
    account_type: string;
    created_at: string;
    last_login_at: string | null;
    login_count: number;
};

type AdminAnalysis = {
    id: number;
    user_id: number;
    username: string;
    email: string;
    risk_score: number;
    risk_level: string;
    confidence_score: number;
    created_at: string;
};

type AdminFlagged = {
    id: number;
    user_id: number;
    username: string;
    email: string;
    risk_score: number;
    risk_level: string;
    confidence_score: number;
    created_at: string;
    classificationTag?: string | null;
    flags?: string[];
    contentType?: string | null;
    contentSummary?: string | null;
};

type AdminPerformance = {
    uptimeSeconds: number;
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    avgResponseMs: number;
    p95ResponseMs: number;
    lastRequestAt?: string | null;
    memoryUsage?: {
        rssMb?: number;
        heapUsedMb?: number;
        heapTotalMb?: number;
    };
};

type AdminLogBundle = {
    source: string;
    lines: string[];
    missing?: boolean;
    lastUpdated?: string | null;
};

const formatDate = (value?: string | null) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatUptime = (value?: number) => {
    if (!Number.isFinite(value)) return 'N/A';
    const total = Math.max(0, Math.floor(value || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};

const toCsv = (rows: Array<Record<string, unknown>>) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escapeCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(','))];
    return lines.join('\n');
};

const AdminDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [windowKey, setWindowKey] = useState('7d');
    const [search, setSearch] = useState('');
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [analyses, setAnalyses] = useState<AdminAnalysis[]>([]);
    const [flagged, setFlagged] = useState<AdminFlagged[]>([]);
    const [performance, setPerformance] = useState<AdminPerformance | null>(null);
    const [logs, setLogs] = useState<AdminLogBundle[]>([]);

    const fetchAdminData = async () => {
        const token = getAdminToken();
        if (!token) {
            navigate('/admin/login');
            return;
        }

        setRefreshing(true);
        setError('');
        try {
            const headers = { Authorization: `Bearer ${token}` };
            const [statsRes, usersRes, analysesRes, flagsRes, perfRes, logsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/admin/stats?window=${encodeURIComponent(windowKey)}`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/users`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/analyses?window=${encodeURIComponent(windowKey)}`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/flags?window=${encodeURIComponent(windowKey)}`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/performance`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/logs?limit=160`, { headers }),
            ]);

            if ([statsRes, usersRes, analysesRes, flagsRes, perfRes, logsRes].some((res) => res.status === 401 || res.status === 403)) {
                clearAdminToken();
                navigate('/admin/login');
                return;
            }
            if (!statsRes.ok || !usersRes.ok || !analysesRes.ok || !flagsRes.ok || !perfRes.ok || !logsRes.ok) {
                throw new Error('Failed to load admin dashboard data.');
            }

            const [statsData, usersData, analysesData, flagsData, perfData, logsData] = await Promise.all([
                statsRes.json(),
                usersRes.json(),
                analysesRes.json(),
                flagsRes.json(),
                perfRes.json(),
                logsRes.json(),
            ]);

            setStats(statsData || null);
            setUsers(Array.isArray(usersData) ? usersData : []);
            setAnalyses(Array.isArray(analysesData) ? analysesData : []);
            setFlagged(Array.isArray(flagsData) ? flagsData : []);
            setPerformance(perfData || null);
            setLogs(Array.isArray(logsData?.logs) ? logsData.logs : []);
        } catch (err: any) {
            setError(err?.message || 'Unknown error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAdminData();
    }, [windowKey]);

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u) =>
            u.username.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.full_name || '').toLowerCase().includes(q)
        );
    }, [users, search]);

    const riskBands = useMemo(() => {
        const result = { low: 0, medium: 0, high: 0 };
        analyses.forEach((a) => {
            const score = Number(a.risk_score || 0);
            if (score >= 70) result.high += 1;
            else if (score >= 40) result.medium += 1;
            else result.low += 1;
        });
        return result;
    }, [analyses]);

    const topRiskRows = useMemo(() => {
        const map = new Map<number, { username: string; count: number; high: number; sum: number }>();
        analyses.forEach((a) => {
            const item = map.get(a.user_id) || { username: a.username, count: 0, high: 0, sum: 0 };
            item.count += 1;
            item.sum += Number(a.risk_score || 0);
            if (Number(a.risk_score || 0) >= 70) item.high += 1;
            map.set(a.user_id, item);
        });
        return Array.from(map.entries())
            .map(([userId, item]) => ({
                userId,
                username: item.username,
                analyses: item.count,
                highRisk: item.high,
                avgRisk: item.count > 0 ? item.sum / item.count : 0,
            }))
            .sort((a, b) => b.avgRisk - a.avgRisk)
            .slice(0, 8);
    }, [analyses]);

    const performanceItems = useMemo(() => {
        if (!performance) return [];
        return [
            { label: 'Uptime', value: formatUptime(performance.uptimeSeconds) },
            { label: 'Total Requests', value: Number(performance.totalRequests || 0).toLocaleString() },
            { label: 'Error Rate', value: `${((performance.errorRate || 0) * 100).toFixed(2)}%` },
            { label: 'Avg Response', value: `${Number(performance.avgResponseMs || 0).toFixed(1)} ms` },
            { label: 'P95 Response', value: `${Number(performance.p95ResponseMs || 0).toFixed(1)} ms` },
            { label: 'Last Request', value: formatDate(performance.lastRequestAt) },
            { label: 'RSS Memory', value: `${performance.memoryUsage?.rssMb ?? 0} MB` },
            { label: 'Heap Used', value: `${performance.memoryUsage?.heapUsedMb ?? 0} MB` },
        ];
    }, [performance]);

    const exportCsv = () => {
        const rows = analyses.map((a) => ({
            id: a.id,
            username: a.username,
            email: a.email,
            risk_score: Number(a.risk_score || 0).toFixed(1),
            risk_level: a.risk_level,
            confidence_score: Number(a.confidence_score || 0).toFixed(1),
            created_at: a.created_at,
        }));
        const csv = toCsv(rows);
        if (!csv) return;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Instagram Authentication-admin-${windowKey}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const logout = () => {
        clearAdminToken();
        navigate('/admin/login');
    };

    if (loading) return <div className="admin-state">Loading admin dashboard...</div>;
    if (error) return <div className="admin-state admin-error">{error}</div>;

    return (
        <div className="admin-shell">
            <header className="admin-topbar">
                <div>
                    <h1>Admin Risk Operations</h1>
                    <p>Unified view of users, analysis outcomes, and platform risk distribution.</p>
                </div>
                <div className="admin-actions">
                    <button onClick={fetchAdminData} disabled={refreshing}><RefreshCw size={16} /> {refreshing ? 'Refreshing...' : 'Refresh'}</button>
                    <button onClick={exportCsv}><Download size={16} /> Export CSV</button>
                    <button className="danger" onClick={logout}><LogOut size={16} /> Logout</button>
                </div>
            </header>

            <section className="admin-kpis">
                <article><Users size={16} /><span>Total Users</span><strong>{stats?.totalUsers ?? 0}</strong></article>
                <article><ShieldAlert size={16} /><span>Total Analyses</span><strong>{stats?.totalAnalyses ?? analyses.length}</strong></article>
                <article><ShieldAlert size={16} /><span>High Risk</span><strong>{stats?.highRiskCount ?? 0}</strong></article>
                <article><ShieldAlert size={16} /><span>Avg Risk</span><strong>{(stats?.avgRiskScore ?? 0).toFixed(1)}</strong></article>
            </section>

            <section className="admin-filterbar">
                <label>
                    Time Window
                    <select value={windowKey} onChange={(e) => setWindowKey(e.target.value)}>
                        <option value="5m">Last 5m</option>
                        <option value="1h">Last 1h</option>
                        <option value="1d">Last 1d</option>
                        <option value="7d">Last 7d</option>
                        <option value="all">All</option>
                    </select>
                </label>
                <label className="search-field">
                    Search User
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="username / email / full name"
                    />
                </label>
                <div className="band-summary">
                    <span>Low: {riskBands.low}</span>
                    <span>Medium: {riskBands.medium}</span>
                    <span>High: {riskBands.high}</span>
                </div>
            </section>

            <main className="admin-grid">
                <section className="admin-panel">
                    <h2>System Performance</h2>
                    {performanceItems.length === 0 ? (
                        <p className="admin-empty">No performance metrics available.</p>
                    ) : (
                        <div className="admin-performance-grid">
                            {performanceItems.map((item) => (
                                <div key={item.label} className="admin-performance-item">
                                    <span>{item.label}</span>
                                    <strong>{item.value}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="admin-panel">
                    <h2>Top Risk Users</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Analyses</th>
                                <th>High Risk</th>
                                <th>Avg Risk</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topRiskRows.map((row) => (
                                <tr key={row.userId}>
                                    <td>{row.username}</td>
                                    <td>{row.analyses}</td>
                                    <td>{row.highRisk}</td>
                                    <td>{row.avgRisk.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section className="admin-panel admin-wide">
                    <h2>Flagged Analyses</h2>
                    {flagged.length === 0 ? (
                        <p className="admin-empty">No flagged analyses in the selected window.</p>
                    ) : (
                        <table className="flagged-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>User</th>
                                    <th>Content</th>
                                    <th>Risk</th>
                                    <th>Tag</th>
                                    <th>Flags</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {flagged.slice(0, 120).map((item) => (
                                    <tr key={`flag-${item.id}`}>
                                        <td>{item.id}</td>
                                        <td>
                                            <div className="flagged-user">
                                                <strong>{item.username}</strong>
                                                <span>{item.email}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="flagged-content">
                                                <span className="flagged-pill">{item.contentType || 'analysis'}</span>
                                                <span>{item.contentSummary || 'No summary'}</span>
                                            </div>
                                        </td>
                                        <td>{Number(item.risk_score || 0).toFixed(1)}%</td>
                                        <td>{item.classificationTag || item.risk_level || 'N/A'}</td>
                                        <td>
                                            {item.flags && item.flags.length > 0 ? (
                                                <div className="flagged-flags">
                                                    {item.flags.slice(0, 3).map((flag, idx) => (
                                                        <span key={`${item.id}-flag-${idx}`} className="flagged-pill muted">
                                                            {flag}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="admin-empty">None</span>
                                            )}
                                        </td>
                                        <td>{formatDate(item.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>

                <section className="admin-panel admin-wide">
                    <h2>Users</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Logins</th>
                                <th>Last Login</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.slice(0, 100).map((u) => (
                                <tr key={u.id}>
                                    <td>{u.id}</td>
                                    <td>{u.username}</td>
                                    <td>{u.email}</td>
                                    <td>{u.account_type}</td>
                                    <td>{u.login_count || 0}</td>
                                    <td>{formatDate(u.last_login_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section className="admin-panel admin-wide">
                    <h2>Recent Analyses</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>User</th>
                                <th>Risk</th>
                                <th>Level</th>
                                <th>Confidence</th>
                                <th>Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analyses.slice(0, 120).map((a) => (
                                <tr key={a.id}>
                                    <td>{a.id}</td>
                                    <td>{a.username}</td>
                                    <td>{Number(a.risk_score || 0).toFixed(1)}</td>
                                    <td>{a.risk_level}</td>
                                    <td>{Number(a.confidence_score || 0).toFixed(1)}</td>
                                    <td>{formatDate(a.created_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section className="admin-panel admin-wide">
                    <h2>System Logs</h2>
                    {logs.length === 0 ? (
                        <p className="admin-empty">No log streams available.</p>
                    ) : (
                        <div className="log-grid">
                            {logs.map((bundle) => (
                                <div key={bundle.source} className="log-card">
                                    <div className="log-header">
                                        <FileText size={14} />
                                        <strong>{bundle.source}</strong>
                                    </div>
                                    <div className="log-meta">
                                        {bundle.missing
                                            ? 'Log file not found.'
                                            : `Last updated ${formatDate(bundle.lastUpdated)}`}
                                    </div>
                                    <div className="log-lines">
                                        {bundle.lines && bundle.lines.length > 0
                                            ? bundle.lines.join('\n')
                                            : 'No log entries yet.'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
};

export default AdminDashboard;

