import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, LogOut, Minus, RefreshCw, Shield, User } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import './Dashboard.css';
import { clearAuthToken, getAuthToken } from '../lib/token-store';
import { DashboardLayout } from '../components/DashboardLayout';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000';

type DashboardResponse = {
    identity?: Record<string, any>;
    profileAnalysis?: Record<string, any>;
    messageAnalysis?: Record<string, any>;
    behaviorAnalysis?: Record<string, any>;
    overallRisk?: number;
    recommendations?: string[];
    riskHistory?: Array<{ risk_score?: number; risk_level?: string; created_at?: string }>;
    riskDrivers?: { profileRisk?: number; messageRisk?: number; behavioralRisk?: number };
    riskDelta?: { current?: number; previous?: number; delta?: number; direction?: 'up' | 'down' | 'flat' };
    topRiskReasons?: string[];
    recentAnalyses?: Array<{
        id?: number;
        contentType?: string;
        riskScore?: number;
        riskLevel?: string;
        createdAt?: string;
        profileTargetUsername?: string | null;
        messageTargetUsername?: string | null;
        messagePreview?: string | null;
    }>;
    analysisContext?: {
        profileTargetUsername?: string | null;
        profileAnalyzedAt?: string | null;
        messageTargetUsername?: string | null;
        messagePreview?: string | null;
        messageAnalyzedAt?: string | null;
        messageTotalMessages?: number;
    };
    selectedWindow?: '5m' | '1h' | '1d' | '7d' | 'all';
};

type MessageVerdictResponse = {
    accountHandle?: string | null;
    displayConversationName?: string | null;
    window?: string;
    sampleSize?: number;
    weightedRiskScore?: number;
    finalLabel?: string;
    verdictMode?: string;
    mixed?: boolean;
    mixedReason?: string | null;
    confidence?: number;
    evidence?: {
        scamEvidence?: number;
        botEvidence?: number;
        spamEvidence?: number;
        tagCounts?: Record<string, number>;
        labelDistribution?: Record<string, number>;
    };
    topReasons?: string[];
};

function parseHeuristicPayload(raw: any): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function riskBand(score: number): 'low' | 'medium' | 'high' {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

function formatVerdictLabel(value: string): string {
    return String(value || '')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Unknown';
}

const Dashboard = () => {
    const navigate = useNavigate();
    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [messageVerdict, setMessageVerdict] = useState<MessageVerdictResponse | null>(null);
    const [messageVerdictLoading, setMessageVerdictLoading] = useState(false);
    const [messageVerdictError, setMessageVerdictError] = useState('');
    const [verdictRefreshKey, setVerdictRefreshKey] = useState(0);

    const forceSessionReset = useCallback((message: string) => {
        clearAuthToken();
        sessionStorage.removeItem('user');
        window.postMessage({ type: 'INSTAGRAM_AUTHENTICATION_USER_LOGGED_OUT' }, window.location.origin);
        setError(message);
        navigate('/login');
    }, [navigate]);

    const fetchDashboard = useCallback(async (options?: { force?: boolean }) => {
        const token = getAuthToken();
        if (!token) {
            forceSessionReset('Authentication required. Please log in again.');
            return;
        }

        try {
            const requestUrl = new URL(`${API_BASE_URL}/api/dashboard`);
            if (options?.force) {
                requestUrl.searchParams.set('_ts', Date.now().toString());
            }

            const response = await fetch(requestUrl.toString(), {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                },
                cache: 'no-store',
            });

            if (response.status === 401 || response.status === 403) {
                const message = response.status === 403
                    ? 'Session expired or invalid token. Please log in again.'
                    : 'Authentication required. Please log in again.';
                forceSessionReset(message);
                return;
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.message || 'Failed to load dashboard');
            }

            const payload = await response.json();
            setData(payload || {});
            setError('');
            setVerdictRefreshKey((prev) => prev + 1);
        } catch (err: any) {
            setError(err?.message || 'Unknown dashboard error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [forceSessionReset]);

    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

    useEffect(() => {
        const token = getAuthToken();
        const rawHandle = String(data?.analysisContext?.messageTargetUsername || '').trim();
        const normalizedHandle = rawHandle.replace(/^@+/, '');
        if (!token || !normalizedHandle) {
            setMessageVerdict(null);
            setMessageVerdictError('');
            setMessageVerdictLoading(false);
            return;
        }

        let cancelled = false;
        const fetchMessageVerdict = async () => {
            setMessageVerdictLoading(true);
            setMessageVerdictError('');
            try {
                const selectedWindow = String(data?.selectedWindow || '7d');
                const requestUrl = new URL(
                    `${API_BASE_URL}/api/accounts/${encodeURIComponent(normalizedHandle)}/final-message-verdict`
                );
                requestUrl.searchParams.set('window', selectedWindow);

                const response = await fetch(requestUrl.toString(), {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Cache-Control': 'no-cache',
                        Pragma: 'no-cache',
                    },
                    cache: 'no-store',
                });

                if (response.status === 401 || response.status === 403) {
                    const message = response.status === 403
                        ? 'Session expired or invalid token. Please log in again.'
                        : 'Authentication required. Please log in again.';
                    forceSessionReset(message);
                    return;
                }
                if (response.status === 404) {
                    if (!cancelled) {
                        setMessageVerdict(null);
                        setMessageVerdictError('No account-level message verdict found for this handle yet.');
                    }
                    return;
                }
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}));
                    throw new Error(payload?.message || 'Failed to load account verdict');
                }

                const payload = await response.json();
                if (!cancelled) {
                    setMessageVerdict(payload || null);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setMessageVerdict(null);
                    setMessageVerdictError(err?.message || 'Failed to load account-level verdict');
                }
            } finally {
                if (!cancelled) setMessageVerdictLoading(false);
            }
        };

        fetchMessageVerdict();
        return () => {
            cancelled = true;
        };
    }, [data?.analysisContext?.messageTargetUsername, data?.selectedWindow, verdictRefreshKey, forceSessionReset]);

    const handleRefresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        await fetchDashboard({ force: true });
    };

    const handleLogout = () => {
        clearAuthToken();
        sessionStorage.removeItem('user');
        window.postMessage({ type: 'INSTAGRAM_AUTHENTICATION_USER_LOGGED_OUT' }, window.location.origin);
        navigate('/login');
    };

    const identity = data?.identity || {};
    const profile = data?.profileAnalysis || {};
    const message = data?.messageAnalysis || {};
    const behavior = data?.behaviorAnalysis || {};
    const riskScore = Number(data?.overallRisk || 0);
    const band = riskBand(riskScore);
    const recommendations = Array.isArray(data?.recommendations) ? data!.recommendations! : [];
    const riskHistory = Array.isArray(data?.riskHistory) ? data!.riskHistory! : [];
    const riskDrivers = data?.riskDrivers || {};
    const riskDelta = data?.riskDelta || { current: 0, previous: 0, delta: 0, direction: 'flat' };
    const topRiskReasons = Array.isArray(data?.topRiskReasons) ? data!.topRiskReasons! : [];
    const recentAnalyses = Array.isArray(data?.recentAnalyses) ? data!.recentAnalyses! : [];
    const analysisContext = data?.analysisContext || {};
    const heuristics = parseHeuristicPayload(profile?.heuristics);
    const heuristicMetrics = [
        { label: 'Structural', value: Number(heuristics.structuralRisk || 0) },
        { label: 'Content', value: Number(heuristics.contentRisk || 0) },
        { label: 'Behavioral', value: Number(heuristics.behavioralRisk || 0) },
        { label: 'Photo', value: Number(heuristics.photoRisk || 0) },
        { label: 'Preliminary', value: Number(heuristics.preliminaryRiskScore || profile?.anomaly_score || 0) },
    ];

    const chartData = useMemo(() => ({
        labels: riskHistory.map((item) => item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'),
        datasets: [
            {
                label: 'Risk Score',
                data: riskHistory.map((item) => Number(item.risk_score || 0)),
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                tension: 0.35,
                fill: true,
                pointRadius: 3,
            },
        ],
    }), [riskHistory]);

    if (loading) {
        return (
            <DashboardLayout contentWidthClass="max-w-7xl">
                <div className="dashboard-state">Loading dashboard...</div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout contentWidthClass="max-w-7xl">
        <div className="dashboard-shell dashboard-shell--embedded">
            <header className="dashboard-topbar">
                <div>
                    <h1>User Security Dashboard</h1>
                    <p>Live account risk intelligence from profile, message, and behavior analysis.</p>
                </div>
                <div className="dashboard-actions">
                    <button type="button" onClick={handleRefresh} disabled={refreshing}>
                        <RefreshCw size={16} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button type="button" className="danger" onClick={handleLogout}>
                        <LogOut size={16} /> Logout
                    </button>
                </div>
            </header>

            <section className="kpi-grid">
                <article className={`kpi-card ${band}`}>
                    <div className="kpi-title"><Shield size={16} /> Overall Risk</div>
                    <div className="kpi-value">{riskScore.toFixed(1)}%</div>
                    <div className="kpi-sub">{band.toUpperCase()} RISK</div>
                </article>
                <article className="kpi-card">
                    <div className="kpi-title"><User size={16} /> Profile Risk</div>
                    <div className="kpi-value">{Number(riskDrivers.profileRisk || profile?.anomaly_score || 0).toFixed(1)}%</div>
                </article>
                <article className="kpi-card">
                    <div className="kpi-title"><AlertTriangle size={16} /> Message Threat</div>
                    <div className="kpi-value">{Number(riskDrivers.messageRisk || message?.threat_score || 0).toFixed(1)}%</div>
                </article>
                <article className="kpi-card">
                    <div className="kpi-title"><BarChart3 size={16} /> Behavioral Anomaly</div>
                    <div className="kpi-value">{Number(riskDrivers.behavioralRisk || behavior?.anomaly_score || 0).toFixed(1)}%</div>
                </article>
            </section>

            <main className="dashboard-content">
                {error ? (
                    <section className="panel panel-wide">
                        <h2>Dashboard Error</h2>
                        <p className="dashboard-error">{error}</p>
                        <p className="dashboard-error">Use Refresh to retry the latest data.</p>
                    </section>
                ) : null}
                <section className="panel">
                    <h2>Account Summary</h2>
                    <div className="detail-grid">
                        <div><span>Name</span><strong>{identity.full_name || identity.username || 'N/A'}</strong></div>
                        <div><span>Username</span><strong>{identity.username || 'N/A'}</strong></div>
                        <div><span>Email</span><strong>{identity.email || 'N/A'}</strong></div>
                        <div><span>Role</span><strong>{identity.account_type || 'user'}</strong></div>
                        <div><span>Last Login</span><strong>{identity.last_login_at ? new Date(identity.last_login_at).toLocaleString() : 'N/A'}</strong></div>
                        <div><span>Account Created</span><strong>{identity.created_at ? new Date(identity.created_at).toLocaleDateString() : 'N/A'}</strong></div>
                    </div>
                </section>

                <section className="panel">
                    <h2>Risk Change</h2>
                    <div className={`risk-delta-wrap risk-delta-${riskDelta.direction || 'flat'}`}>
                        {riskDelta.direction === 'up' ? <ArrowUpRight size={18} /> : riskDelta.direction === 'down' ? <ArrowDownRight size={18} /> : <Minus size={18} />}
                        <strong>{Number(riskDelta.delta || 0) > 0 ? '+' : ''}{Number(riskDelta.delta || 0).toFixed(1)}%</strong>
                        <span>vs previous run ({Number(riskDelta.previous || 0).toFixed(1)}%)</span>
                    </div>
                </section>

                <section className="panel">
                    <h2>Latest Analysis Snapshot</h2>
                    <div className="detail-grid">
                        <div><span>Profile Page Analyzed</span><strong>{analysisContext.profileTargetUsername || profile.analyzed_username || 'N/A'}</strong></div>
                        <div><span>Profile Analysis Time</span><strong>{analysisContext.profileAnalyzedAt ? new Date(analysisContext.profileAnalyzedAt).toLocaleString() : 'N/A'}</strong></div>
                        <div><span>Message Account Analyzed</span><strong>{analysisContext.messageTargetUsername || 'N/A'}</strong></div>
                        <div><span>Message Context</span><strong>{analysisContext.messagePreview || 'N/A'}</strong></div>
                        <div><span>Message Analysis Time</span><strong>{analysisContext.messageAnalyzedAt ? new Date(analysisContext.messageAnalyzedAt).toLocaleString() : 'N/A'}</strong></div>
                        <div><span>Followers</span><strong>{Number(profile.followers_count || 0).toLocaleString()}</strong></div>
                        <div><span>Following</span><strong>{Number(profile.following_count || 0).toLocaleString()}</strong></div>
                        <div><span>Total Posts</span><strong>{Number(profile.total_posts || 0).toLocaleString()}</strong></div>
                        <div><span>Engagement Rate</span><strong>{Number(profile.engagement_rate || 0).toFixed(2)}%</strong></div>
                        <div><span>Messages Scanned</span><strong>{Number(analysisContext.messageTotalMessages || message.total_messages || 0).toLocaleString()}</strong></div>
                        <div><span>Spam Count</span><strong>{Number(message.spam_count || 0).toLocaleString()}</strong></div>
                    </div>
                </section>

                <section className="panel">
                    <h2>Final Message Verdict</h2>
                    {messageVerdictLoading ? (
                        <p>Loading account-level verdict...</p>
                    ) : messageVerdictError ? (
                        <p>{messageVerdictError}</p>
                    ) : messageVerdict ? (
                        <>
                            <div className="detail-grid">
                                <div><span>Target Handle</span><strong>{messageVerdict.displayConversationName || messageVerdict.accountHandle || 'N/A'}</strong></div>
                                <div><span>Final Label</span><strong>{formatVerdictLabel(String(messageVerdict.finalLabel || 'unknown'))}</strong></div>
                                <div><span>Weighted Risk</span><strong>{Number(messageVerdict.weightedRiskScore || 0).toFixed(1)}%</strong></div>
                                <div><span>Confidence</span><strong>{Number(messageVerdict.confidence || 0).toFixed(1)}%</strong></div>
                                <div><span>Sample Size</span><strong>{Number(messageVerdict.sampleSize || 0)}</strong></div>
                                <div><span>Mode</span><strong>{formatVerdictLabel(String(messageVerdict.verdictMode || 'deterministic'))}</strong></div>
                            </div>
                            <ul className="metric-list" style={{ marginTop: 10 }}>
                                {Object.entries(messageVerdict.evidence?.labelDistribution || {}).map(([label, count]) => (
                                    <li key={`dist-${label}`}>
                                        <span>{formatVerdictLabel(label)}</span>
                                        <strong>{Number(count || 0)}</strong>
                                    </li>
                                ))}
                            </ul>
                            <ul className="recommendation-list">
                                {(Array.isArray(messageVerdict.topReasons) ? messageVerdict.topReasons : []).slice(0, 3).map((reason, idx) => (
                                    <li key={`verdict-reason-${idx}`}>{reason}</li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <p>No account-level verdict available yet.</p>
                    )}
                </section>

                <section className="panel panel-wide">
                    <h2>Risk Trend</h2>
                    <div className="trend-chart">
                        <Line data={chartData} options={{ maintainAspectRatio: false }} />
                    </div>
                </section>

                <section className="panel">
                    <h2>Top Risk Reasons</h2>
                    <ul className="recommendation-list">
                        {topRiskReasons.length > 0 ? topRiskReasons.map((reason, idx) => (
                            <li key={`${reason}-${idx}`}>{reason}</li>
                        )) : <li>No specific risk reasons available yet.</li>}
                    </ul>
                </section>

                <section className="panel">
                    <h2>Heuristic Breakdown</h2>
                    <ul className="metric-list">
                        {heuristicMetrics.map((item) => (
                            <li key={item.label}>
                                <span>{item.label}</span>
                                <strong>{item.value.toFixed(1)}/100</strong>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="panel">
                    <h2>Recommendations</h2>
                    <ul className="recommendation-list">
                        {recommendations.length > 0 ? recommendations.map((rec, idx) => (
                            <li key={`${rec}-${idx}`}>{rec}</li>
                        )) : <li>No recommendations available yet. Run profile/message analysis.</li>}
                    </ul>
                </section>

                <section className="panel panel-wide">
                    <h2>Recent Analyses</h2>
                    <div className="recent-analysis-list">
                        {recentAnalyses.length > 0 ? recentAnalyses.map((item, idx) => (
                            <article key={`${item.id || idx}-${item.createdAt || idx}`} className="recent-analysis-item">
                                <div className="recent-analysis-row">
                                    <strong>{String(item.contentType || 'analysis').toUpperCase()} #{item.id ?? 'N/A'}</strong>
                                    <span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A'}</span>
                                </div>
                                <div className="recent-analysis-row">
                                    <span>Risk: {Number(item.riskScore || 0).toFixed(1)}% ({String(item.riskLevel || 'low').toUpperCase()})</span>
                                    <span>
                                        {item.contentType === 'profile'
                                            ? `Profile: ${item.profileTargetUsername || 'N/A'}`
                                            : `DM: ${item.messageTargetUsername || 'N/A'}`}
                                    </span>
                                </div>
                                {item.contentType === 'message' && item.messagePreview ? (
                                    <p className="recent-analysis-preview">{item.messagePreview}</p>
                                ) : null}
                            </article>
                        )) : <p>No recent analyses available.</p>}
                    </div>
                </section>
            </main>
        </div>
        </DashboardLayout>
    );
};

export default Dashboard;

