document.addEventListener('DOMContentLoaded', function() {
    const API_BASE_URL = 'http://localhost:5000';
    const DASHBOARD_URLS = ['http://localhost:3000', 'http://localhost:3001'];
    const MESSAGE_RULESET_VERSION = '2026-03-09-recruitment-v4';

    // Views
    const authView = document.getElementById('auth-view');
    const mainView = document.getElementById('main-view');
    const permissionView = document.getElementById('permission-view');

    // Buttons
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const openDashboardBtn = document.getElementById('openDashboardBtn');
    const analyseProfileBtn = document.getElementById('analyseProfileBtn');
    const analyseMessageBtn = document.getElementById('analyseMessageBtn');
    const finalPredictionBtn = document.getElementById('finalPredictionBtn');
    const finalProfileOnlyBtn = document.getElementById('finalProfileOnlyBtn');
    const finalMessageOnlyBtn = document.getElementById('finalMessageOnlyBtn');
    const confirmDeepAnalysisBtn = document.getElementById('confirmDeepAnalysisBtn');
    const cancelDeepAnalysisBtn = document.getElementById('cancelDeepAnalysisBtn');

    // Display Elements
    const welcomeMessage = document.getElementById('welcome-message');
    const analysisTimer = document.getElementById('analysis-timer');
    const analysisPhase = document.getElementById('analysis-phase');
    const analysisSummary = document.getElementById('analysis-summary');
    const permissionMessage = document.getElementById('permission-message');

    // State variables
    let lastProfileData = null;
    let lastMessageData = null;
    let deepAnalysisCallback = null;
    let lastDeepProfileResult = null;
    let lastDeepMessageResult = null;
    let activeProgressInterval = null;
    let activeProgressStartedAt = null;
    let activeProgressLabel = '';
    const analysisDurations = {
        clientProfileMs: null,
        clientMessageMs: null,
        deepProfileMs: null,
        deepMessageMs: null,
        finalCombinedMs: null,
        finalProfileOnlyMs: null,
        finalMessageOnlyMs: null,
    };

    function formatDurationMs(ms) {
        const safeMs = Number.isFinite(ms) ? Math.max(0, Number(ms)) : 0;
        if (safeMs < 1000) return `${safeMs.toFixed(0)}ms`;
        return `${(safeMs / 1000).toFixed(1)}s`;
    }

    function formatDurationOrNA(ms) {
        return Number.isFinite(ms) ? formatDurationMs(ms) : 'N/A';
    }

    function updateTimerDisplay(text) {
        if (!analysisTimer) return;
        analysisTimer.textContent = text;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function inferPhaseState(text) {
        const normalized = String(text || '').toLowerCase();
        if (!normalized || normalized.includes('idle') || normalized.includes('ready') || normalized.includes('awaiting')) return 'idle';
        if (normalized.includes('fail') || normalized.includes('error')) return 'failed';
        if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('success')) return 'success';
        return 'running';
    }

    function setPhaseStatus(text, state = null) {
        if (!analysisPhase) return;
        analysisPhase.textContent = `Status: ${String(text || 'Idle')}`;
        const resolvedState = state || inferPhaseState(text);
        analysisPhase.classList.remove('status-idle', 'status-running', 'status-success', 'status-failed');
        analysisPhase.classList.add(`status-${resolvedState}`);
    }

    function beginProgressTimer(label) {
        if (activeProgressInterval) {
            clearInterval(activeProgressInterval);
            activeProgressInterval = null;
        }
        activeProgressStartedAt = Date.now();
        activeProgressLabel = String(label || 'Processing');
        const render = () => {
            const elapsed = Date.now() - activeProgressStartedAt;
            updateTimerDisplay(`${activeProgressLabel}: ${formatDurationMs(elapsed)}`);
        };
        render();
        activeProgressInterval = setInterval(render, 100);
    }

    function endProgressTimer() {
        const elapsed = Number.isFinite(activeProgressStartedAt) ? (Date.now() - activeProgressStartedAt) : 0;
        if (activeProgressInterval) {
            clearInterval(activeProgressInterval);
            activeProgressInterval = null;
        }
        activeProgressStartedAt = null;
        activeProgressLabel = '';
        updateTimerDisplay(`Elapsed: ${formatDurationMs(elapsed)}`);
        return elapsed;
    }

    function resetTimerDisplay() {
        if (activeProgressInterval) {
            clearInterval(activeProgressInterval);
            activeProgressInterval = null;
        }
        activeProgressStartedAt = null;
        activeProgressLabel = '';
        updateTimerDisplay('Elapsed: 0.0s');
        setPhaseStatus('Idle');
    }

    function forceLogoutUi(message) {
        lastProfileData = null;
        lastMessageData = null;
        lastDeepProfileResult = null;
        lastDeepMessageResult = null;
        Object.keys(analysisDurations).forEach((key) => {
            analysisDurations[key] = null;
        });
        resetTimerDisplay();
        refreshFinalPredictionButtonState();
        authView.style.display = 'block';
        mainView.style.display = 'none';
        if (analysisSummary && message) {
            analysisSummary.textContent = String(message);
        }
    }

    function getTimingSummaryHtml() {
        return [
            `Client Profile: ${formatDurationOrNA(analysisDurations.clientProfileMs)}`,
            `Client Message: ${formatDurationOrNA(analysisDurations.clientMessageMs)}`,
            `Deep Profile: ${formatDurationOrNA(analysisDurations.deepProfileMs)}`,
            `Deep Message: ${formatDurationOrNA(analysisDurations.deepMessageMs)}`,
            `Final Combined: ${formatDurationOrNA(analysisDurations.finalCombinedMs)}`,
            `Final Profile Only: ${formatDurationOrNA(analysisDurations.finalProfileOnlyMs)}`,
            `Final Message Only: ${formatDurationOrNA(analysisDurations.finalMessageOnlyMs)}`,
        ].join(' | ');
    }

    function refreshFinalPredictionButtonState() {
        const hasProfile = !!lastProfileData;
        const hasMessages = Array.isArray(lastMessageData) && lastMessageData.length > 0;
        const readyForCombinedFinal = hasProfile || hasMessages;
        if (finalPredictionBtn) {
            finalPredictionBtn.disabled = !readyForCombinedFinal;
            finalPredictionBtn.textContent = 'Final Prediction (Combined)';
        }
        if (finalProfileOnlyBtn) finalProfileOnlyBtn.disabled = !hasProfile;
        if (finalMessageOnlyBtn) finalMessageOnlyBtn.disabled = !hasMessages;
    }

    function getStoredToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['token'], (result) => resolve(result.token || null));
        });
    }

    const FOLLOWER_GROWTH_SNAPSHOT_KEY = 'follower_growth_snapshots_v1';
    const PROFILE_ENRICHMENT_CACHE_KEY = 'profile_enrichment_cache_v1';
    const PROFILE_ENRICHMENT_QUEUE_KEY = 'profile_enrichment_queue_v1';
    const MAX_FOLLOWER_SNAPSHOTS_PER_PROFILE = 30;
    const MIN_FOLLOWER_SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000;
    const MAX_PROFILE_ENRICHMENT_ITEMS = 30;
    const PROFILE_ENRICHMENT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
    const PROFILE_ENRICHMENT_RETRY_MIN_DELAY_MS = 2 * 60 * 1000;
    const PROFILE_ENRICHMENT_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
    let profileEnrichmentQueueInFlight = false;

    function getStorageLocal(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result || {}));
        });
    }

    function setStorageLocal(payload) {
        return new Promise((resolve) => {
            chrome.storage.local.set(payload, () => resolve());
        });
    }

    function normalizeProfileKey(username) {
        return String(username || '').trim().toLowerCase();
    }

    function normalizeMediaEvidenceUrl(rawUrl) {
        const raw = String(rawUrl || '').trim();
        if (!raw) return '';
        const directMatch = raw.match(/^https?:\/\/www\.instagram\.com\/(p|reel)\/([^/?#]+)\/?/i);
        if (directMatch) {
            return `https://www.instagram.com/${String(directMatch[1]).toLowerCase()}/${directMatch[2]}/`;
        }
        try {
            const parsed = new URL(raw, 'https://www.instagram.com');
            const normalized = parsed.pathname.match(/^\/(p|reel)\/([^/?#]+)\/?/i);
            if (!normalized) return '';
            return `https://www.instagram.com/${String(normalized[1]).toLowerCase()}/${normalized[2]}/`;
        } catch {
            return '';
        }
    }

    function sanitizeMediaEnrichmentItem(item) {
        const normalizedUrl = normalizeMediaEvidenceUrl(item?.url);
        if (!normalizedUrl) return null;
        const normalizeMetric = (value) => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) return null;
            return Math.round(n);
        };
        const normalizeTimestamp = (value) => {
            const ts = Number(value);
            if (!Number.isFinite(ts) || ts <= 0) return null;
            return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
        };
        const commentUsers = Array.isArray(item?.commentUsernames)
            ? item.commentUsernames
                .map((u) => String(u || '').trim().toLowerCase())
                .filter((u) => /^[a-z0-9._]{2,30}$/i.test(u))
                .slice(0, 50)
            : [];
        return {
            url: normalizedUrl,
            likeCount: normalizeMetric(item?.likeCount),
            commentCount: normalizeMetric(item?.commentCount),
            viewCount: normalizeMetric(item?.viewCount),
            takenAtTimestamp: normalizeTimestamp(item?.takenAtTimestamp ?? item?.taken_at_timestamp),
            caption: String(item?.caption ?? item?.captionText ?? item?.caption_text ?? '').trim() || null,
            commentUsernames: commentUsers,
        };
    }

    function mergeEnrichmentItems(primaryItems, fallbackItems) {
        const mergedByUrl = new Map();
        const register = (item, preferExisting = false) => {
            const sanitized = sanitizeMediaEnrichmentItem(item);
            if (!sanitized) return;
            const key = sanitized.url;
            if (!mergedByUrl.has(key)) {
                mergedByUrl.set(key, sanitized);
                return;
            }
            if (preferExisting) return;
            const current = mergedByUrl.get(key);
            mergedByUrl.set(key, {
                ...current,
                likeCount: sanitized.likeCount ?? current.likeCount,
                commentCount: sanitized.commentCount ?? current.commentCount,
                viewCount: sanitized.viewCount ?? current.viewCount,
                takenAtTimestamp: sanitized.takenAtTimestamp ?? current.takenAtTimestamp,
                caption: sanitized.caption ?? current.caption,
                commentUsernames: (Array.isArray(sanitized.commentUsernames) && sanitized.commentUsernames.length > 0)
                    ? sanitized.commentUsernames
                    : (Array.isArray(current.commentUsernames) ? current.commentUsernames : []),
            });
        };
        (Array.isArray(primaryItems) ? primaryItems : []).forEach((item) => register(item, false));
        (Array.isArray(fallbackItems) ? fallbackItems : []).forEach((item) => register(item, true));
        return Array.from(mergedByUrl.values()).slice(0, MAX_PROFILE_ENRICHMENT_ITEMS);
    }

    async function getCachedProfileEnrichment(username) {
        const key = normalizeProfileKey(username);
        if (!key) return null;
        const storage = await getStorageLocal([PROFILE_ENRICHMENT_CACHE_KEY]);
        const cacheMap = storage[PROFILE_ENRICHMENT_CACHE_KEY] && typeof storage[PROFILE_ENRICHMENT_CACHE_KEY] === 'object'
            ? storage[PROFILE_ENRICHMENT_CACHE_KEY]
            : {};
        const entry = cacheMap[key];
        if (!entry || typeof entry !== 'object') return null;
        const updatedAtMs = Number(entry.updatedAtMs || 0);
        if (!Number.isFinite(updatedAtMs) || (Date.now() - updatedAtMs) > PROFILE_ENRICHMENT_MAX_AGE_MS) {
            return null;
        }
        const items = (Array.isArray(entry.items) ? entry.items : [])
            .map((item) => sanitizeMediaEnrichmentItem(item))
            .filter(Boolean)
            .slice(0, MAX_PROFILE_ENRICHMENT_ITEMS);
        if (items.length === 0) return null;
        const diagnostics = entry.diagnostics && typeof entry.diagnostics === 'object' ? entry.diagnostics : {};
        return { items, diagnostics, updatedAtMs };
    }

    async function setCachedProfileEnrichment(username, payload) {
        const key = normalizeProfileKey(username);
        if (!key) return;
        const sanitizedItems = (Array.isArray(payload?.items) ? payload.items : [])
            .map((item) => sanitizeMediaEnrichmentItem(item))
            .filter(Boolean)
            .slice(0, MAX_PROFILE_ENRICHMENT_ITEMS);
        if (sanitizedItems.length === 0) return;
        const storage = await getStorageLocal([PROFILE_ENRICHMENT_CACHE_KEY]);
        const cacheMap = storage[PROFILE_ENRICHMENT_CACHE_KEY] && typeof storage[PROFILE_ENRICHMENT_CACHE_KEY] === 'object'
            ? storage[PROFILE_ENRICHMENT_CACHE_KEY]
            : {};
        cacheMap[key] = {
            updatedAtMs: Date.now(),
            items: sanitizedItems,
            diagnostics: payload?.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {},
        };
        await setStorageLocal({ [PROFILE_ENRICHMENT_CACHE_KEY]: cacheMap });
    }

    async function getProfileEnrichmentQueue() {
        const storage = await getStorageLocal([PROFILE_ENRICHMENT_QUEUE_KEY]);
        return Array.isArray(storage[PROFILE_ENRICHMENT_QUEUE_KEY]) ? storage[PROFILE_ENRICHMENT_QUEUE_KEY] : [];
    }

    async function setProfileEnrichmentQueue(queue) {
        await setStorageLocal({ [PROFILE_ENRICHMENT_QUEUE_KEY]: Array.isArray(queue) ? queue : [] });
    }

    async function enqueueProfileEnrichmentRetry(username, reason = 'unknown') {
        const profileKey = normalizeProfileKey(username);
        if (!profileKey) return;
        const queue = await getProfileEnrichmentQueue();
        const nowMs = Date.now();
        const existingIndex = queue.findIndex((entry) => normalizeProfileKey(entry?.profileKey) === profileKey);
        const existing = existingIndex >= 0 ? queue[existingIndex] : null;
        const attempts = Number(existing?.attempts || 0);
        const delayMs = Math.min(
            PROFILE_ENRICHMENT_RETRY_MAX_DELAY_MS,
            PROFILE_ENRICHMENT_RETRY_MIN_DELAY_MS * Math.max(1, Math.pow(2, attempts))
        );
        const nextEntry = {
            profileKey,
            attempts,
            nextAttemptMs: nowMs + delayMs,
            reason: String(reason || 'unknown'),
            queuedAtMs: Number(existing?.queuedAtMs || nowMs),
            lastUpdatedMs: nowMs,
        };
        if (existingIndex >= 0) queue[existingIndex] = nextEntry;
        else queue.push(nextEntry);
        await setProfileEnrichmentQueue(queue.slice(-50));
    }

    async function processDeferredProfileEnrichment(username, tabId) {
        const profileKey = normalizeProfileKey(username);
        if (!profileKey || !Number.isFinite(Number(tabId)) || profileEnrichmentQueueInFlight) return;
        profileEnrichmentQueueInFlight = true;
        try {
            const queue = await getProfileEnrichmentQueue();
            const nowMs = Date.now();
            const queueIndex = queue.findIndex((entry) => (
                normalizeProfileKey(entry?.profileKey) === profileKey &&
                Number(entry?.nextAttemptMs || 0) <= nowMs
            ));
            if (queueIndex < 0) return;
            const task = queue[queueIndex];
            const htmlResponse = await chrome.tabs.sendMessage(tabId, {
                type: 'COLLECT_PROFILE_HTML_MEDIA_DETAILS',
                maxItems: 40,
            });
            const items = (htmlResponse?.success && Array.isArray(htmlResponse.items)) ? htmlResponse.items : [];
            const detailsFetched = items.filter((item) => (
                Number.isFinite(toMetricNumber(item?.likeCount)) ||
                Number.isFinite(toMetricNumber(item?.commentCount)) ||
                Number.isFinite(toMetricNumber(item?.viewCount)) ||
                Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp))
            )).length;
            if (items.length > 0 && detailsFetched > 0) {
                await setCachedProfileEnrichment(profileKey, {
                    items,
                    diagnostics: {
                        ...(htmlResponse?.diagnostics || {}),
                        deferredRefresh: true,
                        htmlFallbackUsed: true,
                        detailsFetched,
                    },
                });
                queue.splice(queueIndex, 1);
                await setProfileEnrichmentQueue(queue);
                return;
            }
            const attempts = Number(task?.attempts || 0) + 1;
            const delayMs = Math.min(
                PROFILE_ENRICHMENT_RETRY_MAX_DELAY_MS,
                PROFILE_ENRICHMENT_RETRY_MIN_DELAY_MS * Math.max(1, Math.pow(2, attempts))
            );
            queue[queueIndex] = {
                ...task,
                attempts,
                nextAttemptMs: nowMs + delayMs,
                lastUpdatedMs: nowMs,
            };
            await setProfileEnrichmentQueue(queue);
        } catch {
            // best-effort only
        } finally {
            profileEnrichmentQueueInFlight = false;
        }
    }

    async function upsertFollowerSnapshot(username, followerCount) {
        const key = normalizeProfileKey(username);
        if (!key || !Number.isFinite(followerCount) || followerCount < 0) return [];
        const storage = await getStorageLocal([FOLLOWER_GROWTH_SNAPSHOT_KEY]);
        const snapshotMap = storage[FOLLOWER_GROWTH_SNAPSHOT_KEY] && typeof storage[FOLLOWER_GROWTH_SNAPSHOT_KEY] === 'object'
            ? storage[FOLLOWER_GROWTH_SNAPSHOT_KEY]
            : {};
        const existing = Array.isArray(snapshotMap[key]) ? snapshotMap[key] : [];
        const nowMs = Date.now();
        const latest = existing.length > 0 ? existing[existing.length - 1] : null;
        const next = [...existing];
        const shouldAppend = !latest ||
            Math.abs(Number(latest.followers || 0) - followerCount) > 0 ||
            (nowMs - Number(latest.timestampMs || 0)) >= MIN_FOLLOWER_SNAPSHOT_INTERVAL_MS;
        if (shouldAppend) {
            next.push({
                followers: Math.max(0, Math.round(followerCount)),
                timestampMs: nowMs,
            });
        }
        const bounded = next.slice(-MAX_FOLLOWER_SNAPSHOTS_PER_PROFILE);
        snapshotMap[key] = bounded;
        await setStorageLocal({ [FOLLOWER_GROWTH_SNAPSHOT_KEY]: snapshotMap });
        return bounded;
    }

    function computeFollowerGrowthTrend(snapshots) {
        if (!Array.isArray(snapshots) || snapshots.length < 2) {
            return {
                available: false,
                slopePerDay: null,
                changePercent: null,
                windowDays: null,
            };
        }
        const sorted = [...snapshots]
            .filter((s) => Number.isFinite(Number(s?.followers)) && Number.isFinite(Number(s?.timestampMs)))
            .sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));
        if (sorted.length < 2) {
            return {
                available: false,
                slopePerDay: null,
                changePercent: null,
                windowDays: null,
            };
        }
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const elapsedDays = Math.max(0, (Number(last.timestampMs) - Number(first.timestampMs)) / 86400000);
        if (elapsedDays <= 0) {
            return {
                available: false,
                slopePerDay: null,
                changePercent: null,
                windowDays: 0,
            };
        }
        const change = Number(last.followers) - Number(first.followers);
        const slopePerDay = change / elapsedDays;
        const baseline = Math.max(1, Number(first.followers));
        const changePercent = (change / baseline) * 100;
        return {
            available: true,
            slopePerDay,
            changePercent,
            windowDays: elapsedDays,
        };
    }

    async function apiFetchJSON(path, options = {}) {
        const token = await getStoredToken();
        if (!token) {
            throw new Error('Missing auth token. Please log in from the dashboard again.');
        }

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const errorPayload = await response.json();
                message = errorPayload.message || message;
            } catch {
                // keep default status message
            }
            if (response.status === 401 || response.status === 403) {
                chrome.storage.local.remove(['user', 'token']);
                if (response.status === 403) {
                    message = 'Session expired or invalid token. Please log in again from the dashboard.';
                } else if (response.status === 401) {
                    message = 'Authentication required. Please log in again from the dashboard.';
                }
                forceLogoutUi(message);
            }
            throw new Error(message);
        }

        return response.json();
    }

    function deriveProfilePreliminaryDecision(input) {
        const strongRiskSignals = [
            Number.isFinite(input.structuralScore) && input.structuralScore <= 35,
            Number.isFinite(input.contentScore) && input.contentScore <= 35,
            Number.isFinite(input.behavioralScore) && input.behavioralScore <= 35,
            Number.isFinite(input.photoScore) && input.photoScore <= 35,
        ].filter(Boolean).length;
        const confidenceScore = Number(input.confidenceScore || 0);
        const detailsFetched = Number(input.detailsFetched || 0);
        const interactionSamples = Number(input.interactionSamples || 0);
        const followers = Number(input.followers || 0);
        const following = Number(input.following || 0);
        const posts = Number(input.posts || 0);
        const dataCompleteness = Number(input.dataCompleteness || 0);
        const tierEvidenceCoverage = Number(input.tierEvidenceCoverage || 0);
        const hasTimestampEvidence = input.hasTimestampEvidence === true;
        const hasTier4InteractionEvidence = input.tier4InteractionEvidenceAvailable === true;
        const hasNetworkRatioEvidence = input.hasNetworkRatioEvidence !== false;
        const captionSemanticsMissing = input.captionSemanticsMissing === true;
        const lowCoverage = dataCompleteness < 0.3;
        const insufficientEvidence =
            (
                detailsFetched < PROFILE_EVIDENCE_POLICY.minDetailsFetched &&
                interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples
            ) ||
            lowCoverage;
        const severeDataMissing =
            input.severeDataMissing === true ||
            input.postScrapeMismatch === true;
        const recoverableSparseEvidence =
            severeDataMissing &&
            dataCompleteness >= 0.35 &&
            input.verified === true &&
            Number(input.structuralScore || 0) >= 75 &&
            Number(input.photoScore || 0) >= 55;
        const strictInsufficientEvidence =
            (severeDataMissing && !recoverableSparseEvidence) ||
            lowCoverage ||
            insufficientEvidence;
        const institutionalStructureStrong =
            followers >= 500_000 &&
            following > 0 &&
            following <= 25 &&
            posts >= 100;
        const evidenceBlocked =
            input.behavioralUnavailable === true &&
            detailsFetched === 0 &&
            interactionSamples === 0;
        const sparseEvidenceGate =
            dataCompleteness < 0.45 &&
            detailsFetched < PROFILE_EVIDENCE_POLICY.minDetailsFetched &&
            interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples;
        const strongLegitimacySignals =
            input.verified === true &&
            institutionalStructureStrong &&
            Number(input.structuralScore || 0) >= 70 &&
            Number(input.contentScore || 0) >= 50;
        const institutionalSafeguardEligible =
            input.verified === true &&
            (
                Number(input.officialDomainMentions || 0) > 0 ||
                institutionalStructureStrong
            ) &&
            Number(input.institutionalConfidenceScore || 0) >= 60 &&
            !input.explicitScamSignals &&
            insufficientEvidence;
        const highLegitSparseEvidence =
            input.verified === true &&
            followers >= 10_000_000 &&
            posts >= 200 &&
            Number(input.structuralScore || 0) >= 75 &&
            Number(input.photoScore || 0) >= 55 &&
            Number(input.finalTrust || 0) >= 75 &&
            !input.explicitScamSignals &&
            !input.explicitImpersonationSignal;
        const institutionalVeryLowRiskOverride =
            input.verified === true &&
            followers >= 1_000_000 &&
            posts >= 200 &&
            !strictInsufficientEvidence &&
            input.explicitScamSignals !== true;
        const confidenceRank = { low: 0, 'low-medium': 1, medium: 2, high: 3 };
        const scoreConfidenceLabel =
            confidenceScore >= 0.82 ? 'High' :
                confidenceScore >= 0.64 ? 'Medium' :
                    confidenceScore >= 0.45 ? 'Low-Medium' :
                        'Low';
        const completenessConfidenceLabel =
            dataCompleteness >= 0.7 ? 'High' :
                dataCompleteness >= 0.4 ? 'Medium' :
                    dataCompleteness >= 0.25 ? 'Low-Medium' :
                        'Low';
        let confidenceLabel =
            confidenceRank[String(scoreConfidenceLabel).toLowerCase()] >= confidenceRank[String(completenessConfidenceLabel).toLowerCase()]
                ? scoreConfidenceLabel
                : completenessConfidenceLabel;
        if (dataCompleteness >= 0.7 && tierEvidenceCoverage >= 0.85 && !strictInsufficientEvidence) {
            confidenceLabel = 'High';
        }
        const verifiedHighReachEvidenceStrong =
            input.verified === true &&
            followers >= 1_000_000 &&
            posts >= 200 &&
            dataCompleteness >= 0.8 &&
            detailsFetched >= PROFILE_EVIDENCE_POLICY.minDetailsFetched &&
            interactionSamples >= PROFILE_EVIDENCE_POLICY.minInteractionSamples &&
            !input.explicitScamSignals &&
            !input.explicitImpersonationSignal;
        if (verifiedHighReachEvidenceStrong) {
            confidenceLabel = 'High';
        }
        const highConfidenceBlockedByCoverage =
            input.verified !== true &&
            (
                !hasTimestampEvidence ||
                !hasTier4InteractionEvidence ||
                !hasNetworkRatioEvidence ||
                captionSemanticsMissing
            );
        if (highConfidenceBlockedByCoverage && confidenceLabel === 'High') {
            confidenceLabel = 'Medium';
        }

        if (institutionalVeryLowRiskOverride) {
            return {
                label: 'Very Low Risk (Institutional Override)',
                confidence: confidenceLabel === 'Low' ? 'Medium' : confidenceLabel,
                verdict: 'Verified high-reach account with long posting history and no explicit scam signals.',
            };
        }
        if ((severeDataMissing || strictInsufficientEvidence || sparseEvidenceGate) && highLegitSparseEvidence) {
            return {
                label: 'Low Risk (Limited Evidence)',
                confidence: (confidenceLabel === 'Low' || confidenceLabel === 'Low-Medium') ? 'Medium' : confidenceLabel,
                verdict: 'High-legitimacy verified profile detected; enrichment evidence is limited, so risk is kept low with reduced confidence.',
            };
        }
        if (severeDataMissing && !recoverableSparseEvidence && !input.explicitScamSignals && !input.explicitImpersonationSignal) {
            return {
                label: 'Insufficient Evidence (Likely Legit)',
                confidence: confidenceLabel,
                verdict: 'Core profile evidence is incomplete (media/posts could not be reliably fetched). Avoid high-risk labeling until data quality improves.',
            };
        }
        if (evidenceBlocked && strongLegitimacySignals && !input.explicitScamSignals && !input.explicitImpersonationSignal) {
            return {
                label: 'Insufficient Evidence (Likely Legit)',
                confidence: confidenceLabel,
                verdict: 'Engagement/media fetch was blocked, but profile legitimacy signals are strong. Avoid suspicious labeling without deeper evidence.',
            };
        }
        if ((strictInsufficientEvidence || sparseEvidenceGate || evidenceBlocked) && !input.explicitScamSignals && !input.explicitImpersonationSignal) {
            return {
                label: 'Insufficient Evidence (Needs More Data)',
                confidence: 'Low',
                verdict: 'Current profile-only signals are incomplete; collect additional media/engagement evidence before assigning suspicious labels.',
            };
        }
        if (institutionalSafeguardEligible) {
            return {
                label: 'Low Risk (Institutional Safeguard)',
                confidence: confidenceLabel,
                verdict: 'Institutional signals are strong; evidence is incomplete but no explicit scam pattern was detected.',
            };
        }
        if (input.explicitImpersonationSignal === true) {
            return {
                label: 'High Risk (Impersonation)',
                confidence: confidenceLabel === 'Low' ? 'Low-Medium' : confidenceLabel,
                verdict: 'Username/identity pattern indicates potential impersonation of a public figure.',
            };
        }
        if (input.explicitScamSignals === true && input.preliminaryRisk >= 50) {
            return {
                label: 'High Risk (Preliminary)',
                confidence: confidenceLabel,
                verdict: 'Strong explicit scam cues from profile text/link patterns. Verify before interacting.',
            };
        }
        if (input.behavioralAnomaly === true && input.preliminaryRisk >= 50) {
            return {
                label: 'Suspicious (Preliminary)',
                confidence: confidenceLabel,
                verdict: 'Behavioral activity patterns look abnormal and require deeper verification.',
            };
        }
        if (input.inactivityRiskSignal === true && input.preliminaryRisk >= 45 && input.sustainedActivitySignal !== true) {
            return {
                label: 'Suspicious (Preliminary)',
                confidence: confidenceLabel,
                verdict: 'Account shows high inactive-day ratio with long recent silence; treat as medium-risk until verified.',
            };
        }
        if (input.preliminaryRisk >= 70 || (input.preliminaryRisk >= 55 && strongRiskSignals >= 2)) {
            return { label: 'High Risk (Preliminary)', confidence: confidenceLabel, verdict: 'Likely Scam/Bot - Server verification required' };
        }
        if (input.preliminaryRisk >= 40) {
            return { label: 'Suspicious (Preliminary)', confidence: confidenceLabel, verdict: 'Needs Review' };
        }
        return { label: 'Low Risk (Preliminary)', confidence: confidenceLabel, verdict: 'No strong profile-only indicators' };
    }

    function deriveDeepProfileDecision(serverPrediction, preliminaryRisk) {
        if (serverPrediction === 1 && preliminaryRisk >= 70) {
            return { label: 'Suspicious Profile', confidence: 'Medium', verdict: 'Model + heuristics agree. Continue with message/final analysis.' };
        }
        if (serverPrediction === 1 && preliminaryRisk < 70) {
            return { label: 'Mixed Signals', confidence: 'Low-Medium', verdict: 'Model flagged, but corroboration is weak. Needs review.' };
        }
        if (serverPrediction === 0 && preliminaryRisk < 40) {
            return { label: 'Low Risk', confidence: 'Medium', verdict: 'No strong profile-only risk pattern.' };
        }
        return { label: 'Mixed Signals', confidence: 'Low-Medium', verdict: 'Not enough evidence for a hard label.' };
    }

    function deriveFinalDecision(finalRisk, profileRisk, messageRisk, serverClass) {
        const highCorroboration = finalRisk >= 0.8 && profileRisk >= 0.6 && messageRisk >= 0.6;
        if (highCorroboration) {
            return { label: serverClass || 'High Threat / Scam', confidence: 'High' };
        }
        if (finalRisk >= 0.5) {
            return { label: 'Suspicious - Needs Review', confidence: 'Medium' };
        }
        return { label: 'Low Risk', confidence: 'Medium' };
    }

    function deriveFinalAccountLabelAndReasons({ profileData, messageData, deepProfile, deepMessage, finalRisk }) {
        const reasons = [];
        const profileClass = String(deepProfile?.riskClassification || '').toLowerCase();
        const messageClass = String(deepMessage?.riskClassification || '').toLowerCase();
        const bioLower = String(profileData?.bio || '').toLowerCase();
        const profileHeuristics = profileData?.heuristics || {};
        const mediaDiagnostics = profileHeuristics?.observedSignals?.mediaCollectionDiagnostics || {};
        const detailsFetched = Number(mediaDiagnostics.detailsFetched || 0);
        const interactionSamples = Number(profileHeuristics.interactionSamples || 0);
        const behavioralUnavailable = profileHeuristics.behavioralUnavailable === true;
        const msgHeuristics = messageData?.heuristics || {};
        const redFlagRatio = Number(msgHeuristics.spamScore || 0);
        const msgBurst = Number(msgHeuristics.burstScore || 0);
        const messageSampleCount = Array.isArray(messageData) ? messageData.length : 0;
        const hasDeepProfileResult = Number.isFinite(Number(deepProfile?.riskScore));
        const hasDeepMessageResult = Number.isFinite(Number(deepMessage?.riskScore));
        const hasCredentialSignal = /password|otp|verify|bank|login|2fa|wallet/.test(String(messageData || '').toLowerCase());
        const isGroup = String(profileData?.accountType || '').toLowerCase().includes('group');
        const evidenceMissingReasons = [];
        const accountAgeDays = getProfileAgeDays(profileData);
        const isVeryNewAccount = accountAgeDays > 0 && accountAgeDays < 45;
        const suspiciousLinkCount = Number(msgHeuristics.suspiciousLinkCount || 0);
        const credentialHits = Number(msgHeuristics.credentialHits || 0);
        const pressureHits = Number(msgHeuristics.pressureHits || 0);
        const impersonationHits = Number(msgHeuristics.impersonationHits || 0);
        const phishingLikeSignalStrength = suspiciousLinkCount + credentialHits + pressureHits + impersonationHits;
        const deepMessageRisk = Number(deepMessage?.riskScore || 0) / 100;

        if (!hasDeepProfileResult) evidenceMissingReasons.push('deep profile result is missing');
        if (!hasDeepMessageResult) evidenceMissingReasons.push('deep message result is missing');
        if (detailsFetched < 4) evidenceMissingReasons.push(`media details fetched too low (${detailsFetched}/4)`);
        if (interactionSamples < 4) evidenceMissingReasons.push(`interaction samples too low (${interactionSamples}/4)`);
        if (behavioralUnavailable) evidenceMissingReasons.push('behavioral evidence unavailable');
        if (messageSampleCount < 3) evidenceMissingReasons.push(`message sample too small (${messageSampleCount}/3)`);
        const hasMinimumEvidence = evidenceMissingReasons.length === 0;

        if (isGroup) {
            reasons.push('Conversation metadata indicates a group chat context.');
            if (Array.isArray(profileData?.members) && profileData.members.length > 0) {
                reasons.push(`Detected ${profileData.members.length} participants in group details.`);
            }
            return { label: 'group', confidence: 'High', reasons };
        }

        const hackerSignal = messageClass.includes('hacker') || hasCredentialSignal;
        const scamSignal =
            messageClass.includes('scam') ||
            profileClass.includes('scam') ||
            /crypto|investment|guaranteed|loan|recovery/.test(bioLower);
        const ratio = getSafeProfileCount(profileData?.followers) / Math.max(1, getSafeProfileCount(profileData?.following));
        const botSignal =
            profileClass.includes('bot') ||
            (ratio > 1000 && !profileData?.verified) ||
            (msgBurst >= 20 && redFlagRatio >= 20);
        const hardSignalDetected = hackerSignal || scamSignal || botSignal;
        const messageDominantScamSignal =
            deepMessageRisk >= 0.55 &&
            suspiciousLinkCount > 0 &&
            (credentialHits > 0 || pressureHits > 0 || impersonationHits > 0);

        if (messageDominantScamSignal) {
            const label = credentialHits > 0 || impersonationHits > 0 ? 'hacker' : 'scam';
            reasons.push('Message phishing/scam cues dominate final decision despite profile strength.');
            reasons.push(`Message risk ${(deepMessageRisk * 100).toFixed(1)}/100 with phishing cue strength ${phishingLikeSignalStrength}.`);
            return { label, confidence: deepMessageRisk >= 0.75 ? 'High' : 'Medium', reasons };
        }

        if (!hasMinimumEvidence && hardSignalDetected) {
            reasons.push('High-risk signal detected, but minimum evidence requirements are not met.');
            reasons.push(`Missing evidence: ${evidenceMissingReasons.join('; ')}.`);
            reasons.push('Final hard label suppressed to avoid false positives.');
            return { label: 'insufficient-data', confidence: 'Low', reasons };
        }

        if (!hasMinimumEvidence) {
            reasons.push('Insufficient evidence for a reliable final verdict.');
            reasons.push(`Missing evidence: ${evidenceMissingReasons.join('; ')}.`);
            return { label: 'insufficient-data', confidence: 'Low', reasons };
        }

        if (hackerSignal) {
            reasons.push('Message signals include credential/phishing patterns (e.g., OTP/password/verification).');
            if (messageClass) reasons.push(`Deep message classifier output: ${messageClass}.`);
            return { label: 'hacker', confidence: finalRisk >= 0.7 ? 'High' : 'Medium', reasons };
        }

        if (scamSignal) {
            reasons.push('Scam-like signals detected in message/profile content patterns.');
            if (messageClass || profileClass) reasons.push(`Model classifications: profile=${profileClass || 'n/a'}, message=${messageClass || 'n/a'}.`);
            if (redFlagRatio > 0) reasons.push(`Red-flag message ratio: ${redFlagRatio.toFixed(1)}%.`);
            return { label: 'scam', confidence: finalRisk >= 0.65 ? 'High' : 'Medium', reasons };
        }

        if (botSignal) {
            if (isVeryNewAccount && !hasMinimumEvidence) {
                reasons.push('Bot-like patterns observed, but account is very new and evidence is not sufficient for hard bot classification.');
                reasons.push(`Estimated account age: ${Math.round(accountAgeDays)} days.`);
                return { label: 'suspicious', confidence: 'Low', reasons };
            }
            reasons.push('Bot-like behavioral/structure patterns detected (extreme network ratio or repetitive messaging).');
            if (profileClass) reasons.push(`Deep profile classifier output: ${profileClass}.`);
            return { label: 'bot', confidence: 'Medium', reasons };
        }

        reasons.push('No strong hacker/scam/bot/group evidence from available profile and message signals.');
        return { label: 'likely-human', confidence: finalRisk < 0.45 ? 'Medium' : 'Low-Medium', reasons };
    }

    function mapDecisionLabelToCategory(label) {
        const normalized = String(label || '').toLowerCase();
        if (normalized.includes('hacker')) return 'hacker';
        if (normalized.includes('phishing')) return 'hacker';
        if (normalized.includes('scam')) return 'scam';
        if (normalized.includes('mixed-risk') || normalized.includes('mixed risk')) return 'suspicious';
        if (normalized.includes('spam')) return 'suspicious';
        if (normalized.includes('impersonation')) return 'bot';
        if (normalized.includes('bot')) return 'bot';
        if (normalized.includes('suspicious')) return 'suspicious';
        if (normalized.includes('high risk') || normalized.includes('critical')) return 'suspicious';
        if (normalized.includes('mixed signals')) return 'insufficient-data';
        if (normalized.includes('insufficient')) return 'insufficient-data';
        if (normalized.includes('limited evidence') || normalized.includes('evidence limited')) return 'insufficient-data';
        if (normalized.includes('low risk') || normalized.includes('very low risk') || normalized.includes('likely legit')) return 'genuine';
        return 'genuine';
    }

    function getRiskLevelLabel(score) {
        const n = Number(score) || 0;
        if (n <= 20) return 'Very Low Risk';
        if (n <= 40) return 'Low Risk';
        if (n <= 60) return 'Moderate Risk';
        if (n <= 80) return 'High Risk';
        return 'Critical Risk';
    }

    function getUserConfidenceLabel(value) {
        const raw = String(value || '').toLowerCase().trim();
        if (raw === 'high') return 'High Confidence';
        if (raw === 'medium') return 'Medium Confidence';
        if (raw === 'low') return 'Low Confidence';
        if (raw === 'low-medium') return 'Limited Evidence';
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            if (numeric >= 80) return 'High Confidence';
            if (numeric >= 50) return 'Medium Confidence';
            return 'Very Low Confidence';
        }
        return 'Limited Evidence';
    }

    function getUserStatusLabel(category) {
        const normalized = String(category || '').toLowerCase();
        if (normalized === 'genuine' || normalized === 'likely-human') return 'Legitimate';
        if (normalized === 'suspicious') return 'Needs Review';
        if (normalized === 'insufficient-data') return 'Uncertain';
        if (normalized === 'bot') return 'Likely Automated/Impersonation Risk';
        if (normalized === 'scam') return 'Likely Scam Risk';
        if (normalized === 'hacker') return 'Likely Compromise/Phishing Risk';
        if (normalized === 'group') return 'Group Conversation';
        return 'Under Review';
    }

    function getMissingFeatureLabel(code) {
        const map = {
            media_urls_uncollected: 'Media URLs not collected',
            media_details_unfetched: 'Media details not fetched (captions/hashtags/metrics)',
            interactions_not_computed: 'Interaction metrics not computed (likes/comments)',
            caption_semantics: 'Caption text sample missing',
            timestamp_evidence_unavailable: 'Post timestamp evidence unavailable',
            engagement: 'Engagement sample missing',
            posting_frequency: 'Posting frequency continuity unavailable',
            private_account_limited_visibility: 'Private account limits evidence visibility',
            network_ratio: 'Follower/following ratio unavailable',
            recent_media_sample: 'Recent media sample too small',
            media_access_restricted_private: 'Media access restricted by privacy',
            behavioral_unavailable: 'Behavioral evidence unavailable',
            tier3_media_unavailable: 'Tier 3 media evidence unavailable',
            tier4_interaction_partial: 'Tier 4 interaction evidence partial',
            tier4_interaction_unavailable: 'Tier 4 interaction evidence unavailable',
            behavior_required_ratio_gate: 'Behavioral validation required by risk gate',
            post_scrape_mismatch: 'Post count mismatch against collected media',
            severe_data_missing: 'Severe data missing condition triggered',
        };
        return map[String(code || '')] || String(code || '').replace(/_/g, ' ');
    }

    function getSafeProfileCount(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return clampNumber(Math.trunc(value), 0, 50_000_000_000);
        }
        const parsed = parseInstagramCount(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeHandleText(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function detectPublicFigureImpersonation({ username, fullName, bio, verified, followers, isPrivate }) {
        const rules = [
            { entity: 'bill_gates', aliases: ['billgates'], expectedMinFollowers: 1_000_000 },
            { entity: 'elon_musk', aliases: ['elonmusk'], expectedMinFollowers: 5_000_000 },
            { entity: 'cristiano_ronaldo', aliases: ['cristianoronaldo'], expectedMinFollowers: 5_000_000 },
            { entity: 'selena_gomez', aliases: ['selenagomez'], expectedMinFollowers: 5_000_000 },
            { entity: 'narendra_modi', aliases: ['narendramodi'], expectedMinFollowers: 2_000_000 },
            { entity: 'taylor_swift', aliases: ['taylorswift'], expectedMinFollowers: 5_000_000 },
            { entity: 'kim_kardashian', aliases: ['kimkardashian'], expectedMinFollowers: 5_000_000 },
            { entity: 'mark_zuckerberg', aliases: ['markzuckerberg'], expectedMinFollowers: 1_000_000 },
        ];
        const normalizedUsername = normalizeHandleText(username);
        const normalizedFullName = normalizeHandleText(fullName);
        const loweredBio = String(bio || '').toLowerCase();
        const selfDeclaredFanOrParody = /\b(fan|parody|tribute|backup|unofficial|not official)\b/.test(loweredBio);
        const hasUsableFullName = normalizedFullName.length >= 4;
        const suffixImpersonationCue = /(official|real|support|help|team|backup|fan|fanpage|news|update|offcl|original|_ig|ig)$/;
        let best = {
            score: 0,
            strong: false,
            weak: false,
            entity: null,
            trigger: null,
            expectedMinFollowers: 0,
            followerGapRatio: 0,
        };

        for (const rule of rules) {
            const aliases = rule.aliases.map((alias) => normalizeHandleText(alias));
            const exactUsernameMatch = aliases.some((alias) => normalizedUsername === alias);
            const prefixedUsernameMatch = aliases.some((alias) => normalizedUsername.startsWith(alias) && normalizedUsername.length > alias.length);
            const embeddedAliasMatch = aliases.some((alias) => normalizedUsername.includes(alias) && normalizedUsername !== alias);
            const usernameImpersonationCue = embeddedAliasMatch && suffixImpersonationCue.test(normalizedUsername);
            const fullNameMatch = hasUsableFullName && aliases.some((alias) => normalizedFullName.includes(alias));
            // Never trigger impersonation from full name alone.
            if (!exactUsernameMatch && !prefixedUsernameMatch && !usernameImpersonationCue) continue;

            let score = 0;
            if (exactUsernameMatch) score += 70;
            else if (prefixedUsernameMatch) score += 42;
            else if (usernameImpersonationCue) score += 35;
            if (fullNameMatch) score += 10;
            if (verified !== true) score += 18;
            else score -= 45;
            const expectedMinFollowers = Number(rule.expectedMinFollowers || 0);
            const followerGapRatio = expectedMinFollowers > 0
                ? clampNumber(1 - ((Number(followers || 0) + 1) / expectedMinFollowers), 0, 1)
                : 0;
            score += Math.round(followerGapRatio * 24);
            if (selfDeclaredFanOrParody) score -= 30;
            score = clampNumber(score, 0, 100);
            if (isPrivate === true && !exactUsernameMatch) {
                score = Math.min(score, 54);
            }
            const strong = (
                (exactUsernameMatch && verified !== true && followerGapRatio >= 0.4) ||
                score >= 78
            ) && !(isPrivate === true && !exactUsernameMatch);
            const weak = !strong && score >= 55;

            if (score > best.score) {
                best = {
                    score,
                    strong,
                    weak,
                    entity: rule.entity,
                    trigger: exactUsernameMatch
                        ? 'exact_handle'
                        : (prefixedUsernameMatch ? 'prefixed_handle' : 'embedded_handle_with_cue'),
                    expectedMinFollowers,
                    followerGapRatio: Number(followerGapRatio.toFixed(2)),
                };
            }
        }
        return best;
    }

    function getProfileAgeDays(profileData) {
        const ageCandidates = [
            profileData?.heuristics?.temporalMetrics?.accountAgeDays,
            profileData?.heuristics?.observedSignals?.temporalMetrics?.accountAgeDays,
            profileData?.heuristics?.accountAgeDays,
        ];
        for (const candidate of ageCandidates) {
            const age = Number(candidate);
            if (Number.isFinite(age) && age > 0) return age;
        }
        return 0;
    }

    function isInstitutionalVeryLowRiskProfile(profileData, options = {}) {
        const followers = getSafeProfileCount(profileData?.followers);
        const posts = getSafeProfileCount(profileData?.postCount);
        const verified = profileData?.verified === true;
        const isPrivate = profileData?.private === true;
        const username = String(profileData?.username || '').toLowerCase();
        const bio = String(profileData?.bio || '').toLowerCase();
        const keywordHits = Number(options.keywordHits || 0);
        const suspiciousLinkMatches = Number(options.suspiciousLinkMatches || 0);
        const explicitScamSignals = options.explicitScamSignals === true;
        const scamLikeUsername = /bot|spam|free|follow|support|loan|recovery/i.test(username);
        const scamLikeBio = /\b(crypto|investment|guaranteed|loan|recovery|telegram|whatsapp|double money)\b/i.test(bio);
        return (
            verified &&
            followers >= 1_000_000 &&
            posts >= 200 &&
            !isPrivate &&
            !explicitScamSignals &&
            keywordHits === 0 &&
            suspiciousLinkMatches === 0 &&
            !scamLikeUsername &&
            !scamLikeBio
        );
    }

    function deriveProfileOnlyFinalDecision(profileData, profileRisk) {
        const reasons = [];
        const followers = getSafeProfileCount(profileData?.followers);
        const following = getSafeProfileCount(profileData?.following);
        const posts = getSafeProfileCount(profileData?.postCount);
        const ratio = followers / Math.max(1, following);
        const verified = profileData?.verified === true;
        const accountAgeDays = getProfileAgeDays(profileData);
        const isVeryNewAccount = accountAgeDays > 0 && accountAgeDays < 45;
        const interactionSamples = Number(
            profileData?.heuristics?.interactionSamples ??
            profileData?.heuristics?.observedSignals?.interactionSamples ??
            0
        );
        const detailsFetched = Number(
            profileData?.heuristics?.observedSignals?.mediaCollectionDiagnostics?.detailsFetched ??
            0
        );
        const behaviorEvidenceStrong = interactionSamples >= 6 && detailsFetched >= 6;
        const bio = String(profileData?.bio || '').toLowerCase();
        const suspiciousBioHits = (bio.match(/\b(crypto|investment|guaranteed|loan|recovery|telegram|whatsapp)\b/g) || []).length;
        const profileClass = String(lastDeepProfileResult?.riskClassification || '').toLowerCase();
        const profileSignals = profileData?.heuristics?.inferredSignals || {};
        const explicitImpersonationSignal = profileSignals.explicitImpersonationSignal === true;
        const explicitScamSignals =
            profileSignals.explicitScamSignals === true ||
            explicitImpersonationSignal ||
            suspiciousBioHits >= 2;
        const institutionalVeryLowRiskOverride = isInstitutionalVeryLowRiskProfile(profileData, {
            explicitScamSignals,
            keywordHits: suspiciousBioHits,
            suspiciousLinkMatches: Number(profileData?.heuristics?.observedSignals?.suspiciousLinkMatches || 0),
        });
        const botPattern = !verified && ((ratio > 1000 && following < 200) || (following > 1000 && followers < 300)) && posts < 25;
        const profileOnlyEvidenceWeak =
            !behaviorEvidenceStrong ||
            (isVeryNewAccount && !explicitScamSignals);

        if (institutionalVeryLowRiskOverride) {
            reasons.push('Institutional override applied: verified account with very large reach and established posting history.');
            reasons.push('No explicit scam indicators were detected in profile signals.');
            return { category: 'genuine', confidence: 'High', reasons };
        }
        if (explicitScamSignals && profileRisk >= 0.55) {
            if (explicitImpersonationSignal) {
                reasons.push('Potential public-figure impersonation pattern detected on profile identity signals.');
                return { category: 'bot', confidence: 'Medium', reasons };
            }
            reasons.push('Profile bio/signals include scam-associated patterns.');
            reasons.push(`Scam signal score supported by profile risk ${Math.round(profileRisk * 100)}/100.`);
            return { category: 'scam', confidence: 'Medium', reasons };
        }
        if (botPattern || profileClass.includes('bot')) {
            if (profileOnlyEvidenceWeak) {
                reasons.push('Bot-like structure detected, but profile-only evidence is insufficient for a hard bot label.');
                if (isVeryNewAccount) reasons.push(`Account appears very new (${Math.round(accountAgeDays)} days).`);
                reasons.push(`Evidence depth: details=${detailsFetched}, interactions=${interactionSamples}.`);
                return { category: 'insufficient-data', confidence: 'Low', reasons };
            }
            reasons.push('Profile structure resembles bot-like network behavior.');
            reasons.push(`Follower/following ratio observed at ${ratio.toFixed(2)}.`);
            return { category: 'bot', confidence: 'Medium', reasons };
        }

        if (profileOnlyEvidenceWeak && profileRisk >= 0.4) {
            reasons.push('Profile-only risk is elevated but evidence is not strong enough for bot/scam classification.');
            if (isVeryNewAccount) reasons.push(`Account appears very new (${Math.round(accountAgeDays)} days).`);
            return { category: 'suspicious', confidence: 'Low', reasons };
        }

        if (profileOnlyEvidenceWeak) {
            reasons.push('Profile-only evidence is insufficient for a high-confidence label.');
            if (isVeryNewAccount) reasons.push(`Account appears very new (${Math.round(accountAgeDays)} days).`);
            return { category: 'insufficient-data', confidence: 'Low', reasons };
        }

        reasons.push('No strong scam/bot/hacker indicators from profile-only evidence.');
        reasons.push('Message analysis not provided; verdict uses profile signals only.');
        return { category: 'genuine', confidence: profileRisk < 0.45 ? 'Medium' : 'Low-Medium', reasons };
    }

    function parseInstagramCount(value) {
        const MAX_IG_COUNT = 50000000000;
        if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
        const raw = String(value || '').trim().replace(/\u00a0/g, ' ');
        if (!raw) return 0;
        const compact = raw.replace(/,/g, '').toUpperCase();
        const match = compact.match(/(\d+(?:\.\d+)?)\s*([KMB])?/);
        if (!match) return 0;
        const base = Number.parseFloat(match[1]);
        if (!Number.isFinite(base)) return 0;
        const suffix = match[2];
        if (suffix === 'K') return Math.min(MAX_IG_COUNT, Math.trunc(base * 1_000));
        if (suffix === 'M') return Math.min(MAX_IG_COUNT, Math.trunc(base * 1_000_000));
        if (suffix === 'B') return Math.min(MAX_IG_COUNT, Math.trunc(base * 1_000_000_000));
        return Math.min(MAX_IG_COUNT, Math.trunc(base));
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function toMetricNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const raw = String(value || '').trim();
        if (!raw || raw.toUpperCase() === 'N/A') return null;
        const parsed = parseInstagramCount(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function getNestedValue(obj, path) {
        if (!obj || !path) return undefined;
        const parts = String(path).split('.');
        let current = obj;
        for (const part of parts) {
            if (current == null || typeof current !== 'object' || !(part in current)) return undefined;
            current = current[part];
        }
        return current;
    }

    function normalizeMediaItemForScoring(item) {
        const base = item && typeof item === 'object' ? item : {};
        const node = base.node && typeof base.node === 'object' ? base.node : null;
        const merged = node ? { ...node, ...base } : { ...base };
        if (!merged.url) {
            const shortcode = merged.shortcode || getNestedValue(merged, 'node.shortcode');
            if (shortcode) merged.url = `https://www.instagram.com/p/${shortcode}/`;
        }
        return merged;
    }

    function extractMediaTimestampSeconds(item) {
        const candidates = [
            item?.takenAtTimestamp,
            item?.taken_at_timestamp,
            item?.taken_at,
            item?.timestamp,
            item?.createdAt,
            item?.createdAtTimestamp,
            item?.created_time,
            item?.date,
            getNestedValue(item, 'node.taken_at_timestamp'),
            getNestedValue(item, 'node.timestamp'),
            getNestedValue(item, 'node.created_time'),
        ];
        for (const candidate of candidates) {
            const ts = toUnixTimestampSeconds(candidate);
            if (Number.isFinite(ts)) return ts;
        }
        return null;
    }

    function extractMediaCaption(item) {
        const candidates = [
            item?.caption,
            item?.captionText,
            item?.caption_text,
            item?.accessibilityCaption,
            getNestedValue(item, 'edge_media_to_caption.edges.0.node.text'),
            getNestedValue(item, 'node.edge_media_to_caption.edges.0.node.text'),
            item?.accessibility_caption,
            getNestedValue(item, 'node.accessibility_caption'),
            getNestedValue(item, 'node.caption.text'),
            item?.title,
            item?.text,
        ];
        for (const candidate of candidates) {
            const text = String(candidate || '').trim();
            if (text) return text;
        }
        return '';
    }

    function extractMediaMetric(item, metric) {
        const metricPaths = {
            likes: [
                'likeCount',
                'like_count',
                'likes',
                'edge_media_preview_like.count',
                'edge_liked_by.count',
                'node.like_count',
                'node.edge_media_preview_like.count',
                'node.edge_liked_by.count',
            ],
            comments: [
                'commentCount',
                'comment_count',
                'comments',
                'edge_media_to_comment.count',
                'edge_media_to_parent_comment.count',
                'node.comment_count',
                'node.edge_media_to_comment.count',
                'node.edge_media_to_parent_comment.count',
            ],
            views: [
                'viewCount',
                'view_count',
                'video_view_count',
                'play_count',
                'videoPlayCount',
                'node.view_count',
                'node.video_view_count',
                'node.play_count',
            ],
        };
        const paths = metricPaths[metric] || [];
        for (const path of paths) {
            const value = getNestedValue(item, path);
            const parsed = toMetricNumber(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    }

    function average(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        return values.reduce((sum, n) => sum + n, 0) / values.length;
    }

    function standardDeviation(values) {
        if (!Array.isArray(values) || values.length < 2) return 0;
        const avg = average(values);
        const variance = values.reduce((sum, n) => sum + ((n - avg) ** 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    function median(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    }

    function toUnixTimestampSeconds(value) {
        const MIN_IG_TIMESTAMP_SEC = 1262304000; // 2010-01-01 UTC
        const MAX_FUTURE_DRIFT_SEC = 86400; // 1 day
        const nowSec = Math.trunc(Date.now() / 1000);
        const normalizeAndValidate = (candidate) => {
            if (!Number.isFinite(candidate)) return null;
            const normalized = candidate > 1e12 ? (candidate / 1000) : candidate;
            const truncated = Math.trunc(normalized);
            if (truncated < MIN_IG_TIMESTAMP_SEC) return null;
            if (truncated > (nowSec + MAX_FUTURE_DRIFT_SEC)) return null;
            return truncated;
        };
        if (typeof value === 'number' && Number.isFinite(value)) {
            return normalizeAndValidate(value);
        }
        const raw = String(value || '').trim();
        if (!raw || raw.toUpperCase() === 'N/A') return null;
        if (/^\d+$/.test(raw)) {
            const parsed = Number.parseInt(raw, 10);
            return normalizeAndValidate(parsed);
        }
        const parsedMs = Date.parse(raw);
        if (!Number.isFinite(parsedMs)) return null;
        return normalizeAndValidate(parsedMs);
    }

    function computeIntervalDays(timestampsSec) {
        if (!Array.isArray(timestampsSec) || timestampsSec.length < 2) return [];
        const sorted = [...timestampsSec].sort((a, b) => b - a);
        const intervals = [];
        for (let i = 0; i < sorted.length - 1; i += 1) {
            const deltaSec = sorted[i] - sorted[i + 1];
            if (deltaSec > 0) intervals.push(deltaSec / 86400);
        }
        return intervals;
    }

    function evaluateContinuityWindow(activeDaySet, windowDays, nowSec, minActiveDays, minStreakDays) {
        const nowDay = Math.floor(nowSec / 86400);
        let activeDays = 0;
        let longestStreak = 0;
        let currentStreak = 0;
        for (let offset = 0; offset < windowDays; offset += 1) {
            const dayKey = nowDay - offset;
            if (activeDaySet.has(dayKey)) {
                activeDays += 1;
                currentStreak += 1;
                longestStreak = Math.max(longestStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }
        const coverage = windowDays > 0 ? (activeDays / windowDays) : 0;
        const isContinuous = activeDays >= minActiveDays && longestStreak >= minStreakDays;
        const status = activeDays === 0
            ? 'inactive'
            : (isContinuous ? 'continuous' : 'intermittent');
        return {
            windowDays,
            activeDays,
            coverage,
            longestStreakDays: longestStreak,
            isContinuous,
            status,
        };
    }

    function computeOnlineContinuity(timestampsSec, nowSec) {
        if (!Array.isArray(timestampsSec) || timestampsSec.length === 0) {
            return {
                dataQuality: 'insufficient',
                statuses: {
                    daily: { status: 'insufficient-data' },
                    weekly: { status: 'insufficient-data' },
                    monthly: { status: 'insufficient-data' },
                },
            };
        }
        const activeDaySet = new Set(
            timestampsSec
                .filter((ts) => Number.isFinite(ts))
                .map((ts) => Math.floor(ts / 86400))
        );
        const daily = evaluateContinuityWindow(activeDaySet, 1, nowSec, 1, 1);
        const weekly = evaluateContinuityWindow(activeDaySet, 7, nowSec, 5, 3);
        const monthly = evaluateContinuityWindow(activeDaySet, 30, nowSec, 20, 7);
        const continuousWindowCount =
            (daily.isContinuous ? 1 : 0) +
            (weekly.isContinuous ? 1 : 0) +
            (monthly.isContinuous ? 1 : 0);
        const overallStatus = continuousWindowCount === 3
            ? 'continuously-online'
            : (continuousWindowCount > 0 ? 'partially-continuous' : 'not-continuous');
        return {
            dataQuality: timestampsSec.length >= 8 ? 'good' : 'limited',
            overallStatus,
            statuses: { daily, weekly, monthly },
        };
    }

    function shannonEntropy(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const counts = new Map();
        values.forEach((value) => {
            const key = String(value);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const total = values.length;
        let entropy = 0;
        counts.forEach((count) => {
            const p = count / total;
            if (p > 0) entropy -= p * Math.log2(p);
        });
        return entropy;
    }

    function getScrapeSourceReliability(scrapeSource) {
        if (scrapeSource === 'network_api') return 0.95;
        if (scrapeSource === 'legacy_script_json') return 0.85;
        if (scrapeSource === 'dom_fallback') return 0.65;
        return 0.7;
    }

    // Frozen policy constants: keep structural behavior stable while improving acquisition depth.
    const TRUST_POLICY = {
        behavioralTrustCeilingWithoutEvidence: 68,
        behavioralRequiredCeiling: 60,
        ratioBehaviorGate: {
            minFollowers: 250_000,
            minFollowerFollowingRatio: 2000,
            maxInstitutionalConfidenceWithoutBehavior: 70,
        },
    };
    const PROFILE_EVIDENCE_PRESETS = {
        strict: { minInteractionSamples: 6, minDetailsFetched: 6, minDataCompleteness: 0.75 },
        balanced: { minInteractionSamples: 4, minDetailsFetched: 4, minDataCompleteness: 0.65 },
        lenient: { minInteractionSamples: 2, minDetailsFetched: 2, minDataCompleteness: 0.5 },
    };
    const ACTIVE_PROFILE_EVIDENCE_PRESET = 'balanced';
    const PROFILE_EVIDENCE_POLICY =
        PROFILE_EVIDENCE_PRESETS[ACTIVE_PROFILE_EVIDENCE_PRESET] || PROFILE_EVIDENCE_PRESETS.balanced;

    const TRUST_WEIGHT_PROFILES = {
        full: { structural: 0.28, content: 0.3, behavioral: 0.32, photo: 0.1 },
        medium: { structural: 0.27, content: 0.35, behavioral: 0.28, photo: 0.1 },
        basic: { structural: 0.25, content: 0.4, behavioral: 0.2, photo: 0.15 },
        none: { structural: 0.3, content: 0.45, behavioral: 0, photo: 0.25 },
    };

    function deriveTrustTier(finalTrust, options = {}) {
        const confidenceScore = Number(options.confidenceScore || 0);
        const behavioralUnavailable = options.behavioralUnavailable === true;
        const requiresBehavioralValidation = options.requiresBehavioralValidation === true;
        const severeDataMissing = options.severeDataMissing === true;
        const explicitScamSignals = options.explicitScamSignals === true;
        const explicitImpersonationSignal = options.explicitImpersonationSignal === true;
        const posts = Number(options.posts || 0);
        const followers = Number(options.followers || 0);
        const accountType = String(options.accountType || '').toLowerCase();
        const entityClass = String(options.entityClass || '').toLowerCase();
        const detailsFetched = Number(options.detailsFetched || 0);
        const interactionSamples = Number(options.interactionSamples || 0);
        const dataCompleteness = Number(options.dataCompleteness || 0);
        const noExplicitRiskSignals = !explicitScamSignals && !explicitImpersonationSignal;
        const eliteVerifiedGlobalProfile =
            options.verified === true &&
            followers >= 50_000_000 &&
            posts >= 1000 &&
            noExplicitRiskSignals;
        const highTrustVerifiedBrandProfile =
            options.verified === true &&
            followers >= 5_000_000 &&
            posts >= 500 &&
            noExplicitRiskSignals &&
            (
                accountType.includes('business') ||
                accountType.includes('professional') ||
                accountType.includes('creator') ||
                entityClass === 'corporate'
            );
        const sparseEvidence =
            detailsFetched === 0 &&
            interactionSamples === 0 &&
            posts === 0;
        const unassessedSparseProfile =
            noExplicitRiskSignals &&
            (
                severeDataMissing ||
                ((behavioralUnavailable || requiresBehavioralValidation) && confidenceScore < 0.45)
            ) &&
            (sparseEvidence || dataCompleteness < 0.45);
        if (unassessedSparseProfile) {
            return 'Unassessed / Neutral';
        }
        if (eliteVerifiedGlobalProfile) {
            return 'Strong Legit';
        }
        if (highTrustVerifiedBrandProfile && finalTrust >= 60) {
            return 'Strong Legit';
        }
        if ((behavioralUnavailable || requiresBehavioralValidation) && confidenceScore < 0.45) {
            if (finalTrust >= 60) return 'Likely Legit (Low Evidence)';
            if (finalTrust >= 50) return 'Uncertain';
            return 'Unassessed / Neutral';
        }
        if (finalTrust >= 90) return 'Verified Institutional';
        if (finalTrust >= 80) return 'Strong Legit';
        if (finalTrust >= 70) return 'Legit';
        if (finalTrust >= 60) return 'Likely Legit';
        if (finalTrust >= 50) return 'Uncertain';
        return noExplicitRiskSignals ? 'Unassessed / Neutral' : 'Suspicious';
    }

    function deriveIdentityValidity({ verified, followers, confidenceScore }) {
        if (verified === true && followers >= 100_000) {
            return 'Official Organization';
        }
        if (verified === true) {
            return 'Verified Account';
        }
        if (confidenceScore >= 0.75 && followers >= 50_000) {
            return 'Probable Public Identity (Unverified)';
        }
        return 'Identity Uncertain';
    }

    function deriveAccountTypeDisplay({ accountType, institutionalType }) {
        if (institutionalType === 'governance' || institutionalType === 'science') {
            return 'Organization / Government';
        }
        if (institutionalType === 'international') {
            return 'Organization / Institutional';
        }
        const normalized = String(accountType || '').toLowerCase();
        if (!normalized || normalized === 'unknown' || normalized === 'user') return 'Personal / User';
        if (normalized.includes('business')) return 'Business / Organization';
        if (normalized.includes('professional')) return 'Professional';
        if (normalized.includes('creator')) return 'Creator';
        return String(accountType || 'Unknown');
    }

    function deriveBehavioralNormality({ behavioralState, behavioralScore }) {
        if (behavioralState === 'unknown') return 'Undetermined';
        if (behavioralState === 'anomalous') return 'Anomalous';
        if (Number.isFinite(behavioralScore) && behavioralScore >= 60) return 'Normal';
        return 'Mixed';
    }

    function deriveValidAccountClass({ verified, followers, posts, accountType, institutionalType, ratio }) {
        if (verified !== true) {
            return {
                code: 'unverified_or_unknown',
                label: 'Unverified / Unknown',
                detail: 'No official badge; cannot assert official identity class.',
            };
        }

        const normalizedType = String(accountType || '').toLowerCase();
        const isViralAnomaly =
            followers >= 1_000_000 &&
            posts <= 15 &&
            ratio >= 10_000;
        if (isViralAnomaly) {
            return {
                code: 'viral_event_anomaly',
                label: 'Viral Event Anomaly',
                detail: 'Verified high-reach account with very low post volume and outsized follower concentration.',
            };
        }

        const isBrandLikeType =
            normalizedType.includes('business') ||
            normalizedType.includes('professional') ||
            normalizedType.includes('creator');
        const isMediaBrand =
            followers >= 500_000 &&
            (isBrandLikeType || institutionalType !== 'general' || posts >= 80);
        if (isMediaBrand) {
            return {
                code: 'media_or_brand',
                label: 'Media / Brand Account',
                detail: 'Verified content brand pattern with high reach and recurring publish footprint.',
            };
        }

        if (followers >= 1_000_000) {
            return {
                code: 'celebrity_personal_brand',
                label: 'Celebrity Personal Brand',
                detail: 'Verified public-figure profile with high-authority personal identity signals.',
            };
        }

        return {
            code: 'verified_public_account',
            label: 'Verified Public Account',
            detail: 'Verified account that does not strongly match the top three valid classes.',
        };
    }

    function quantile(values, q) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const pos = (sorted.length - 1) * clampNumber(q, 0, 1);
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        }
        return sorted[base];
    }

    function scoreWithinBand(value, min, max, scale = 1) {
        if (!Number.isFinite(value)) return 0;
        if (value >= min && value <= max) return 1;
        const gap = value < min ? (min - value) : (value - max);
        const denom = Math.max(0.0001, ((max - min) * scale));
        return clampNumber(1 - (gap / denom), -1, 1);
    }

    function deriveEntityBaseline({ accountType, institutionalType, followers, following, verified, bio, username, fullName, hasProfilePic }) {
        const type = String(accountType || '').toLowerCase();
        const bioText = String(bio || '').toLowerCase();
        const user = String(username || '').toLowerCase();
        const fullNameText = String(fullName || '').trim();
        const fullNameWords = fullNameText ? fullNameText.split(/\s+/).filter(Boolean).length : 0;
        const sportsHint = /\b(cricket|football|soccer|basketball|athlete|captain|team)\b/.test(bioText) || /\bfc\b/.test(user);
        const musicHint = /\b(singer|music|album|tour|artist|actor|actress|official)\b/.test(bioText);
        const brandHint =
            type.includes('business') ||
            type.includes('professional') ||
            type.includes('brand') ||
            /\b(store|shop|inc|company|corp|motors)\b/.test(bioText) ||
            /\binc|motors\b/.test(user);
        const publicFigureHint =
            type.includes('public figure') ||
            type.includes('athlete') ||
            type.includes('artist') ||
            type.includes('personal') ||
            sportsHint ||
            musicHint ||
            (verified === true &&
                hasProfilePic === true &&
                fullNameWords >= 2 &&
                followers >= 1_000_000 &&
                following > 20 &&
                !brandHint);
        const hybridCreatorHint =
            type.includes('creator') ||
            type.includes('influencer') ||
            ((publicFigureHint || musicHint) && /collab|partner|ambassador|founder|entrepreneur/.test(bioText));

        if (institutionalType === 'science' || institutionalType === 'governance' || institutionalType === 'international') {
            return {
                entityClass: 'institutional',
                expectedEngagement: { min: 0.03, max: 1.8 },
                expectedCommentLike: { min: 0.004, max: 0.14 },
                expectedCadenceDays: { min: 2, max: 21 },
                expectedEngagementCvMax: 2.8,
            };
        }

        if (publicFigureHint && !hybridCreatorHint) {
            return {
                entityClass: 'public_figure',
                expectedEngagement: { min: 0.2, max: 6.5 },
                expectedCommentLike: { min: 0.008, max: 0.22 },
                expectedCadenceDays: { min: 1, max: 20 },
                expectedEngagementCvMax: 3.2,
            };
        }

        if (hybridCreatorHint) {
            return {
                entityClass: 'hybrid_creator',
                expectedEngagement: { min: 0.12, max: 4.8 },
                expectedCommentLike: { min: 0.008, max: 0.22 },
                expectedCadenceDays: { min: 1, max: 18 },
                expectedEngagementCvMax: 3.1,
            };
        }

        if (brandHint || (verified && followers >= 1_000_000)) {
            return {
                entityClass: 'corporate',
                expectedEngagement: { min: 0.05, max: 2.5 },
                expectedCommentLike: { min: 0.003, max: 0.12 },
                expectedCadenceDays: { min: 1, max: 16 },
                expectedEngagementCvMax: 2.6,
            };
        }

        return {
            entityClass: 'general',
            expectedEngagement: { min: 0.03, max: 8 },
            expectedCommentLike: { min: 0.003, max: 0.3 },
            expectedCadenceDays: { min: 1, max: 25 },
            expectedEngagementCvMax: 3.5,
        };
    }

    async function requestMediaMetricEnrichment(mediaItems, maxItems = 20) {
        try {
            const targetItems = Math.max(1, Math.min(60, Number(maxItems) || 20));
            const maxCollectAttempts = 1;
            const scopedItems = (Array.isArray(mediaItems) ? mediaItems : []).slice(0, targetItems);
            const prefetchedItems = scopedItems.filter((item) => (
                Number.isFinite(toMetricNumber(item?.likeCount)) ||
                Number.isFinite(toMetricNumber(item?.commentCount)) ||
                Number.isFinite(toMetricNumber(item?.viewCount)) ||
                Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp))
            ));
            const prefetchedTimestampCount = scopedItems.filter((item) =>
                Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp))
            ).length;
            const prefetchedCaptionCount = scopedItems.filter((item) =>
                String(item?.caption ?? item?.captionText ?? item?.caption_text ?? '').trim().length > 0
            ).length;
            const prefetchedThreshold = Math.min(6, Math.max(3, Math.floor(targetItems * 0.25)));
            const prefetchedCoverage = targetItems > 0 ? (prefetchedItems.length / targetItems) : 0;
            const minimumTemporalCoverage = Math.min(4, Math.max(2, Math.floor(targetItems * 0.2)));
            const minimumCaptionCoverage = Math.min(4, Math.max(2, Math.floor(targetItems * 0.2)));
            const hasBaselineCoverage = prefetchedItems.length >= prefetchedThreshold || prefetchedCoverage >= 0.25;
            const hasTemporalCoverage = prefetchedTimestampCount >= minimumTemporalCoverage;
            const hasCaptionCoverage = prefetchedCaptionCount >= minimumCaptionCoverage;
            // Only skip enrichment when we already have not just interaction metrics,
            // but also usable temporal and caption evidence.
            if (hasBaselineCoverage && hasTemporalCoverage && hasCaptionCoverage) {
                return {
                    items: prefetchedItems.map((item) => ({
                        url: item.url,
                        likeCount: item.likeCount ?? null,
                        commentCount: item.commentCount ?? null,
                        viewCount: item.viewCount ?? null,
                        takenAtTimestamp: item.takenAtTimestamp ?? item.taken_at_timestamp ?? null,
                        caption: String(item?.caption ?? item?.captionText ?? item?.caption_text ?? '').trim() || null,
                    })),
                    diagnostics: {
                        urlsCollected: scopedItems.length,
                        detailsFetched: prefetchedItems.length,
                        interactionsComputed: prefetchedItems.filter((item) => {
                            const likes = toMetricNumber(item.likeCount);
                            const comments = toMetricNumber(item.commentCount);
                            const views = toMetricNumber(item.viewCount);
                            return (likes || 0) + (comments || 0) + ((views || 0) * 0.02) > 0;
                        }).length,
                        collectAttempts: 0,
                        retryAttempts: 0,
                        skippedNetworkEnrichment: true,
                    },
                };
            }
            const urlsNeedingEnrichment = scopedItems
                .filter((item) => {
                    const hasInteractionMetric =
                        Number.isFinite(toMetricNumber(item?.likeCount)) ||
                        Number.isFinite(toMetricNumber(item?.commentCount)) ||
                        Number.isFinite(toMetricNumber(item?.viewCount));
                    const hasTimestampMetric =
                        Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp));
                    const hasCaptionMetric =
                        String(item?.caption ?? item?.captionText ?? item?.caption_text ?? '').trim().length > 0;
                    // Re-enrich when any critical evidence axis is missing.
                    return !(hasInteractionMetric && hasTimestampMetric && hasCaptionMetric);
                })
                .map((m) => String(m?.url || '').trim())
                .filter((u) => /^https?:\/\/www\.instagram\.com\/(p|reel)\//i.test(u));
            const enrichmentBudget = Math.min(
                targetItems,
                prefetchedItems.length > 0
                    ? (targetItems >= 20 ? 10 : targetItems >= 12 ? 8 : 6)
                    : (targetItems >= 20 ? 12 : targetItems >= 12 ? 9 : 6)
            );
            let urls = Array.from(new Set(urlsNeedingEnrichment)).slice(0, Math.min(enrichmentBudget, targetItems));
            const fallbackHintByUrl = new Map();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) {
                return {
                    items: [],
                    diagnostics: {
                        urlsCollected: 0,
                        detailsFetched: 0,
                        interactionsComputed: 0,
                        collectAttempts: 0,
                    },
                };
            }
            const absorbFallbackHintResponse = (fallbackResponse) => {
                if (!(fallbackResponse?.success && fallbackResponse.detailsByUrl && typeof fallbackResponse.detailsByUrl === 'object')) {
                    return;
                }
                Object.entries(fallbackResponse.detailsByUrl).forEach(([url, details]) => {
                    const normalizedUrl = normalizeMediaEvidenceUrl(url);
                    if (!normalizedUrl) return;
                    if (!details || typeof details !== 'object') return;
                    fallbackHintByUrl.set(normalizedUrl, {
                        url: normalizedUrl,
                        likeCount: Number.isFinite(toMetricNumber(details.likeCount)) ? toMetricNumber(details.likeCount) : null,
                        commentCount: Number.isFinite(toMetricNumber(details.commentCount)) ? toMetricNumber(details.commentCount) : null,
                        viewCount: Number.isFinite(toMetricNumber(details.viewCount)) ? toMetricNumber(details.viewCount) : null,
                        takenAtTimestamp: toUnixTimestampSeconds(details.takenAtTimestamp) ?? toUnixTimestampSeconds(details.taken_at_timestamp) ?? null,
                        caption: String(details.caption ?? details.captionText ?? details.caption_text ?? '').trim() || null,
                        commentUsernames: Array.isArray(details.commentUsernames) ? details.commentUsernames : [],
                    });
                });
            };
            // Always perform one warm collection pass so inline/embedded hint details are available,
            // even when URL list is already full and no fallback loop would run.
            const warmFallbackResponse = await chrome.tabs.sendMessage(tab.id, {
                type: 'COLLECT_RECENT_MEDIA_URLS',
                maxItems: Math.min(12, targetItems),
            });
            if (warmFallbackResponse?.success && Array.isArray(warmFallbackResponse.items)) {
                urls = Array.from(new Set([...urls, ...warmFallbackResponse.items])).slice(0, Math.min(enrichmentBudget, targetItems));
            }
            absorbFallbackHintResponse(warmFallbackResponse);
            const tryProfileHtmlFallback = async () => {
                const htmlResponse = await chrome.tabs.sendMessage(tab.id, {
                    type: 'COLLECT_PROFILE_HTML_MEDIA_DETAILS',
                    maxItems: Math.min(40, Math.max(20, targetItems * 2)),
                });
                if (!(htmlResponse?.success && Array.isArray(htmlResponse.items) && htmlResponse.items.length > 0)) {
                    return null;
                }
                const htmlDiagnostics = htmlResponse.diagnostics || {};
                return {
                    items: htmlResponse.items,
                    diagnostics: {
                        ...htmlDiagnostics,
                        urlsCollected: Number(htmlDiagnostics.urlsCollected || 0),
                        detailsFetched: Number(htmlDiagnostics.detailsFetched || htmlResponse.items.length || 0),
                        interactionsComputed: Number(htmlDiagnostics.interactionsComputed || 0),
                        collectAttempts: 0,
                        retryAttempts: 0,
                        htmlFallbackUsed: true,
                    },
                };
            };
            let collectAttempts = 0;
            while (urls.length < Math.min(enrichmentBudget, targetItems) && collectAttempts < maxCollectAttempts) {
                collectAttempts += 1;
                const fallbackResponse = await chrome.tabs.sendMessage(tab.id, {
                    type: 'COLLECT_RECENT_MEDIA_URLS',
                    maxItems: Math.min(12, targetItems),
                });
                if (fallbackResponse?.success && Array.isArray(fallbackResponse.items)) {
                    urls = Array.from(new Set([...urls, ...fallbackResponse.items])).slice(0, Math.min(enrichmentBudget, targetItems));
                }
                absorbFallbackHintResponse(fallbackResponse);
                if (urls.length >= Math.min(enrichmentBudget, targetItems)) break;
            }
            if (urls.length === 0) {
                const htmlFallback = await tryProfileHtmlFallback();
                if (htmlFallback) return htmlFallback;
                return {
                    items: [],
                    diagnostics: {
                        urlsCollected: 0,
                        detailsFetched: 0,
                        interactionsComputed: 0,
                        collectAttempts,
                    },
                };
            }
            const response = await chrome.tabs.sendMessage(tab.id, {
                type: 'ENRICH_MEDIA_METRICS',
                mediaUrls: urls,
                maxItems: Math.min(enrichmentBudget, targetItems),
            });
            const firstPassItems = (response?.success && Array.isArray(response.items)) ? response.items : [];
            let items = mergeEnrichmentItems(firstPassItems, Array.from(fallbackHintByUrl.values()), Math.min(enrichmentBudget, targetItems));
            let retryAttempts = 0;
            const firstPassRateLimited = response?.diagnostics?.rateLimited === true;
            if (!firstPassRateLimited && items.length < Math.min(3, urls.length) && urls.length > 0) {
                retryAttempts += 1;
                await new Promise((resolve) => setTimeout(resolve, 450));
                const retryResponse = await chrome.tabs.sendMessage(tab.id, {
                    type: 'ENRICH_MEDIA_METRICS',
                    mediaUrls: urls.slice(0, Math.min(2, urls.length)),
                    maxItems: Math.min(2, targetItems),
                });
                if (retryResponse?.success && Array.isArray(retryResponse.items) && retryResponse.items.length > items.length) {
                    items = retryResponse.items;
                }
            }
            if (items.length === 0) {
                const htmlFallback = await tryProfileHtmlFallback();
                if (htmlFallback) {
                    const mergedDiagnostics = {
                        ...(response?.diagnostics || {}),
                        ...(htmlFallback.diagnostics || {}),
                        rateLimited: firstPassRateLimited || (response?.diagnostics?.rateLimited === true),
                    };
                    return { items: htmlFallback.items, diagnostics: mergedDiagnostics };
                }
                const emptyDiagnostics = response?.diagnostics || {};
                return {
                    items: [],
                    diagnostics: {
                        ...emptyDiagnostics,
                        urlsCollected: urls.length,
                        detailsFetched: 0,
                        interactionsComputed: 0,
                        collectAttempts,
                        retryAttempts,
                        rateLimited: emptyDiagnostics.rateLimited === true,
                        rateLimit429Total: Number(emptyDiagnostics.rateLimit429Total || 0),
                        rateLimitBlockedUntil: Number(emptyDiagnostics.rateLimitBlockedUntil || 0),
                    },
                };
            }
            const detailsFetched = items.filter((item) => (
                Number.isFinite(toMetricNumber(item?.likeCount)) ||
                Number.isFinite(toMetricNumber(item?.commentCount)) ||
                Number.isFinite(toMetricNumber(item?.viewCount)) ||
                Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp))
            )).length;
            const interactionsComputed = items.filter((item) => {
                const likes = toMetricNumber(item.likeCount);
                const comments = toMetricNumber(item.commentCount);
                const views = toMetricNumber(item.viewCount);
                return (likes || 0) + (comments || 0) + ((views || 0) * 0.02) > 0;
            }).length;
            if (detailsFetched === 0) {
                const htmlFallback = await tryProfileHtmlFallback();
                if (htmlFallback?.items?.length > 0) {
                    const mergedItems = mergeEnrichmentItems(items, htmlFallback.items, Math.min(enrichmentBudget, targetItems));
                    const mergedDetailsFetched = mergedItems.filter((item) => (
                        Number.isFinite(toMetricNumber(item?.likeCount)) ||
                        Number.isFinite(toMetricNumber(item?.commentCount)) ||
                        Number.isFinite(toMetricNumber(item?.viewCount)) ||
                        Number.isFinite(toUnixTimestampSeconds(item?.takenAtTimestamp ?? item?.taken_at_timestamp))
                    )).length;
                    const mergedInteractionsComputed = mergedItems.filter((item) => {
                        const likes = toMetricNumber(item.likeCount);
                        const comments = toMetricNumber(item.commentCount);
                        const views = toMetricNumber(item.viewCount);
                        return (likes || 0) + (comments || 0) + ((views || 0) * 0.02) > 0;
                    }).length;
                    return {
                        items: mergedItems,
                        diagnostics: {
                            ...(response?.diagnostics || {}),
                            ...(htmlFallback.diagnostics || {}),
                            urlsCollected: Math.max(
                                Number(response?.diagnostics?.urlsCollected || urls.length),
                                Number(htmlFallback?.diagnostics?.urlsCollected || 0)
                            ),
                            detailsFetched: mergedDetailsFetched,
                            interactionsComputed: mergedInteractionsComputed,
                            collectAttempts,
                            retryAttempts,
                            htmlFallbackUsed: true,
                            rateLimited: response?.diagnostics?.rateLimited === true,
                        },
                    };
                }
            }
            const upstreamDiagnostics = response?.diagnostics || {};
            return {
                items,
                diagnostics: {
                    ...upstreamDiagnostics,
                    urlsCollected: urls.length,
                    detailsFetched: Math.max(detailsFetched, Number(upstreamDiagnostics.detailsFetched || 0)),
                    interactionsComputed: Math.max(interactionsComputed, Number(upstreamDiagnostics.interactionsComputed || 0)),
                    collectAttempts,
                    retryAttempts,
                },
            };
        } catch (error) {
            console.warn('[Instagram Authentication] Media enrichment request failed:', error);
            return {
                items: [],
                diagnostics: {
                    urlsCollected: 0,
                    detailsFetched: 0,
                    interactionsComputed: 0,
                    collectAttempts: 0,
                    failed: true,
                },
            };
        }
    }

    // --- Phase 1: Extension Boot Behavior ---
    const checkAuthAndPageStatus = () => {
        console.log('[Instagram Authentication] Popup: Checking auth status.');
        chrome.storage.local.get(['user', 'token'], (result) => {
            console.log('[Instagram Authentication] Popup: Read from chrome.storage.local. Result:', result);
            if (result.user && result.token) {
                console.log('[Instagram Authentication] Popup: User found. Displaying main view.');
                authView.style.display = 'none';
                mainView.style.display = 'block';
                welcomeMessage.textContent = `Welcome, ${result.user.fullName || result.user.username}!`;
                updateButtonVisibility();
            } else {
                if (result.user || result.token) {
                    chrome.storage.local.remove(['user', 'token']);
                }
                console.log('[Instagram Authentication] Popup: No user found. Displaying auth view.');
                authView.style.display = 'block';
                mainView.style.display = 'none';
            }
        });
    };

    // --- Phase 2: Button Matrix by Page Type ---
    function updateButtonVisibility() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            const url = tabs[0].url;
            if (url.includes('instagram.com/')) {
                if (url.includes('/direct/')) {
                    // Message Page
                    analyseProfileBtn.style.display = 'none';
                    analyseMessageBtn.style.display = 'inline-block';
                    setPhaseStatus('Ready (Messages)');
                } else {
                    // Profile Page
                    analyseProfileBtn.style.display = 'inline-block';
                    analyseMessageBtn.style.display = 'none';
                    setPhaseStatus('Ready (Profile)');
                }
                analysisSummary.textContent = 'Ready for analysis.';
            } else {
                // Not on Instagram
                analyseProfileBtn.style.display = 'none';
                analyseMessageBtn.style.display = 'none';
                analysisSummary.textContent = 'Navigate to an Instagram page to begin.';
                setPhaseStatus('Idle');
            }
            refreshFinalPredictionButtonState();
        });
    }

    // --- Phase 3: Client-Side Profile Analysis ---
    analyseProfileBtn.addEventListener('click', () => {
        beginProgressTimer('Client Profile Analysis');
        setPhaseStatus('Scraping profile');
        analysisSummary.textContent = "Performing client-side profile analysis...";
        permissionView.style.display = 'none';
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ANALYZE_PAGE' }, function(response) {
                if (chrome.runtime.lastError) {
                    const elapsed = endProgressTimer();
                    analysisSummary.textContent = "Error communicating with content script. Please reload the page.";
                    updateTimerDisplay(`Client Profile Analysis failed after ${formatDurationMs(elapsed)}`);
                    setPhaseStatus('Failed');
                    return;
                }
                if (response && response.success) {
                    if (response.data.status === 'BACKGROUND_ANALYSIS_STARTED') {
                        setPhaseStatus('Running in hidden tab');
                        analysisSummary.innerHTML = `DM page detected. Analyzing <b>${response.data.username}</b> in a hidden tab...`;
                        // Result will be sent via a different message
                    } else {
                        handleClientProfileAnalysis(response.data);
                    }
                } else {
                    const elapsed = endProgressTimer();
                    analysisSummary.textContent = "Failed to scrape profile. Ensure you are on a valid Instagram profile or DM page.";
                    updateTimerDisplay(`Client Profile Analysis failed after ${formatDurationMs(elapsed)}`);
                    setPhaseStatus('Failed');
                }
            });
        });
    });
    
    // Listener for background analysis results
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'FORWARD_ANALYSIS_TO_POPUP') {
            if (request.data && request.data.success) {
                handleClientProfileAnalysis(request.data.data);
            } else {
                const elapsed = endProgressTimer();
                analysisSummary.textContent = "Hidden tab analysis failed.";
                updateTimerDisplay(`Client Profile Analysis failed after ${formatDurationMs(elapsed)}`);
                setPhaseStatus('Failed');
            }
        }
    });

    async function handleClientProfileAnalysis(data, elapsedMs = null) {
        setPhaseStatus('Extracting profile signals');
        let effectiveElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : null;
        lastProfileData = data; // Store raw data for deep analysis
        refreshFinalPredictionButtonState();
        console.log('[Instagram Authentication] Raw scraped profile payload:', data);
        const profileKeyForEnrichment = normalizeProfileKey(data?.username);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTabId = tabs?.[0]?.id;
            if (Number.isFinite(Number(activeTabId)) && profileKeyForEnrichment) {
                processDeferredProfileEnrichment(profileKeyForEnrichment, Number(activeTabId));
            }
        });

        // --- heuristic/behavioral/photo feature extraction ---
        const followerCount = parseInstagramCount(data.followers);
        const followingCount = parseInstagramCount(data.following);
        const postCount = parseInstagramCount(data.postCount);
        const externalUrls = Array.isArray(data.externalUrls)
            ? data.externalUrls.map((url) => String(url || '').trim()).filter(Boolean)
            : [];
        const primaryExternalUrl = externalUrls.length > 0 ? externalUrls[0] : null;
        const accountTypeRaw = String(data.accountType || 'Unknown');
        const hasBioSignal = bioLength => Number.isFinite(bioLength) && bioLength > 0;
        const hasNetworkRatioEvidence =
            Number.isFinite(followerCount) &&
            Number.isFinite(followingCount) &&
            (followerCount > 0 || followingCount > 0);
        const ratio = hasNetworkRatioEvidence
            ? (followingCount > 0 ? (followerCount / followingCount) : Number.POSITIVE_INFINITY)
            : 0;
        const followerGrowthSnapshots = await upsertFollowerSnapshot(data.username, followerCount);
        const followerGrowthTrend = computeFollowerGrowthTrend(followerGrowthSnapshots);
        data.followerGrowthSnapshots = followerGrowthSnapshots;
        data.followerGrowthTrend = followerGrowthTrend;
        console.log('[Instagram Authentication] Raw scraped data before scoring', {
            username: data.username || 'N/A',
            followers: followerCount,
            following: followingCount,
            posts: postCount,
            verified: data.verified === true,
        });
        const bio = (data.bio || '').toLowerCase();
        const username = (data.username || '').toLowerCase();
        const fullNameRaw = String(data.fullName || '');
        const impersonationDetection = detectPublicFigureImpersonation({
            username,
            fullName: fullNameRaw,
            bio: data.bio || '',
            verified: data.verified === true,
            followers: followerCount,
            isPrivate: data.private === true,
        });
        const explicitImpersonationSignal = impersonationDetection.strong === true;
        const weakImpersonationSignal = !explicitImpersonationSignal && impersonationDetection.weak === true;
        const usernameDigits = (username.match(/\d/g) || []).length;
        const usernameDigitRatio = username.length > 0 ? usernameDigits / username.length : 0;
        const linkMatches = (bio.match(/https?:\/\/|www\.|t\.me|bit\.ly|tinyurl/g) || []).length;
        const suspiciousBioKeywords = ['crypto', 'investment', 'telegram', 'whatsapp', 'guaranteed', 'earn money', 'double money', 'loan', 'recovery', 'support'];
        const keywordHits = suspiciousBioKeywords.filter((k) => bio.includes(k)).length;
        const institutionalKeywords = ['official', 'government', 'agency', 'public', 'science', 'research', 'education', 'policy', 'international', 'national', 'exploring', 'planet', 'space'];
        const institutionalHits = institutionalKeywords.filter((k) => bio.includes(k)).length;
        const scienceTerms = ['space', 'science', 'research', 'exploring', 'planet', 'mission', 'universe', 'innovation'];
        const governanceTerms = ['white house', 'administration', 'president', 'government', 'policy', 'nation', 'office'];
        const internationalTerms = ['united nations', 'international', 'global', 'human rights', 'peace', 'development', 'world'];
        const persuasionTerms = ['donate', 'support us', 'act now', 'join', 'campaign', 'petition'];
        const scienceHits = scienceTerms.filter((k) => bio.includes(k)).length;
        let governanceHits = governanceTerms.filter((k) => bio.includes(k)).length;
        const internationalHits = internationalTerms.filter((k) => bio.includes(k)).length;
        const persuasionHits = persuasionTerms.filter((k) => bio.includes(k)).length;
        let institutionalType = 'general';
        let governanceEntity = 'none';
        if (/\bwhite\s*house\b|@whitehouse|\bpotus\b/.test(bio) || username.includes('whitehouse') || username.includes('potus')) {
            governanceEntity = 'white_house';
            institutionalType = 'governance';
            governanceHits = Math.max(governanceHits, 1);
        } else if (/\bnational\s+aeronautics\s+and\s+space\s+administration\b|\bnasa\b/.test(bio) || username === 'nasa' || username.includes('nasa')) {
            governanceEntity = 'nasa';
            institutionalType = 'science';
        } else if (/\bindian\s+space\s+research\s+organisation\b|\bisro\b/.test(bio) || username === 'isro' || username.includes('isro')) {
            governanceEntity = 'isro';
            institutionalType = 'science';
        } else if (
            /\bunicef\b|\bunited\s+nations\s+children'?s?\s+fund\b/.test(bio) ||
            ['unicef', 'who', 'un', 'unesco', 'undp', 'unwomen', 'unhumanrights'].includes(username)
        ) {
            governanceEntity = 'united_nations';
            institutionalType = 'international';
        } else if (
            /\bunited\s+nations\b|\bun\b/.test(bio) ||
            username === 'un' ||
            /\bunitednations\b/.test(username)
        ) {
            governanceEntity = 'united_nations';
            institutionalType = 'international';
        } else if (scienceHits >= governanceHits && scienceHits >= internationalHits && scienceHits > 0) {
            institutionalType = 'science';
        } else if (internationalHits >= governanceHits && internationalHits > 0) {
            institutionalType = 'international';
        } else if (governanceHits > 0) {
            institutionalType = 'governance';
        }
        const entityBaseline = deriveEntityBaseline({
            accountType: data.accountType,
            institutionalType,
            followers: followerCount,
            following: followingCount,
            verified: data.verified === true,
            bio: data.bio || '',
            username,
            fullName: data.fullName || '',
            hasProfilePic: data.hasProfilePic === true,
        });
        const suspiciousLinkMatches = (bio.match(/bit\.ly|tinyurl|t\.me|linktr\.ee|cutt\.ly|goo\.gl|rb\.gy|wa\.me|telegram/gi) || []).length;
        const officialDomainMentions = (bio.match(/\b[a-z0-9.-]+\.(gov|edu|org)\b/gi) || []).length;
        const officialTrustMentions = (bio.match(/\bofficial|verification|verified|public agency|government\b/gi) || []).length;
        const bioLength = (data.bio || '').trim().length;
        let institutionalConfidenceScore = 0;
        if (data.verified === true) institutionalConfidenceScore += 35;
        if (governanceEntity !== 'none') institutionalConfidenceScore += 25;
        institutionalConfidenceScore += Math.min(20, institutionalHits * 4);
        institutionalConfidenceScore += Math.min(12, governanceHits * 3);
        institutionalConfidenceScore += Math.min(8, scienceHits * 2);
        institutionalConfidenceScore += Math.min(8, internationalHits * 2);
        institutionalConfidenceScore += Math.min(12, officialDomainMentions * 6);
        if (institutionalType === 'governance') institutionalConfidenceScore += 6;
        else if (institutionalType === 'international') institutionalConfidenceScore += 5;
        else if (institutionalType === 'science') institutionalConfidenceScore += 4;
        const enterpriseStructureStrong =
            data.verified === true &&
            followerCount >= 500_000 &&
            followingCount > 0 &&
            followingCount <= 25 &&
            postCount >= 100;
        if (enterpriseStructureStrong) institutionalConfidenceScore += 22;
        if (data.verified === true && followerCount >= 5_000_000) institutionalConfidenceScore += 10;
        if (entityBaseline.entityClass === 'corporate' && data.verified === true && followerCount >= 1_000_000) institutionalConfidenceScore += 8;
        if (data.hasExternalUrl) institutionalConfidenceScore += 8;
        institutionalConfidenceScore = clampNumber(Math.round(institutionalConfidenceScore), 0, 100);

        // Structural trust score (higher = more legitimate profile structure).
        // Use continuous components to avoid mega-account saturation at identical values.
        let structuralScore = 0;
        if (data.verified === true) structuralScore += 32;
        const followerMagnitude = followerCount > 0 ? Math.log10(followerCount + 1) : 0;
        structuralScore += clampNumber(Math.round((followerMagnitude - 3) * 8), 0, 26);
        const postMagnitude = postCount > 0 ? Math.log10(postCount + 1) : 0;
        structuralScore += clampNumber(Math.round((postMagnitude - 0.7) * 12), 0, 18);
        if (data.private === false) structuralScore += 8;
        if (data.hasProfilePic) structuralScore += 6;
        const ratioLog = ratio > 0 ? Math.log10(ratio + 1) : 0;
        if (ratioLog >= 1.2 && ratioLog <= 6.8) structuralScore += 8;
        else if (ratioLog >= 0.5 && ratioLog <= 8) structuralScore += 4;
        else if (ratio >= 0.35 && ratio <= 2.5) structuralScore += 2;
        else structuralScore -= 6;

        if (!data.verified && ratio > 1000 && followingCount < 200) structuralScore -= 22;
        if (!data.verified && followingCount > 1000 && followerCount < 300) structuralScore -= 18;
        if (postCount === 0 && followerCount > 5000) structuralScore -= 15;
        if (!data.hasProfilePic) structuralScore -= 24;
        if (followingCount === 0 && followerCount === 0) structuralScore -= 20;
        if (explicitImpersonationSignal) structuralScore -= 26;
        else if (weakImpersonationSignal) structuralScore -= 12;
        const hasBasicHumanSignals =
            data.hasProfilePic === true &&
            followerCount > 0 &&
            followingCount > 0 &&
            postCount > 0 &&
            keywordHits === 0 &&
            suspiciousLinkMatches === 0 &&
            !explicitImpersonationSignal;
        if (hasBasicHumanSignals) {
            structuralScore = Math.max(structuralScore, 32);
        }

        // Content trust score (higher = more legitimate identity/content signals).
        let contentScore = 10;
        if (officialDomainMentions > 0) contentScore += Math.min(35, officialDomainMentions * 25);
        if (data.hasExternalUrl) contentScore += 12;
        if (officialTrustMentions > 0) contentScore += Math.min(12, officialTrustMentions * 4);
        if (institutionalHits > 0) contentScore += Math.min(16, institutionalHits * 4);
        if (data.verified === true) contentScore += 10;
        if (institutionalType === 'science') contentScore += 10;
        else if (institutionalType === 'international') contentScore += 8;
        else if (institutionalType === 'governance') contentScore += 6;
        contentScore -= Math.min(10, persuasionHits * 3);

        const verifiedHighReach = data.verified === true && followerCount >= 1_000_000;
        const keywordPenaltyWeight = verifiedHighReach ? 6 : 10;
        const suspiciousLinkPenaltyWeight = verifiedHighReach ? 6 : 14;
        contentScore -= Math.min(45, keywordHits * keywordPenaltyWeight);
        contentScore -= Math.min(35, suspiciousLinkMatches * suspiciousLinkPenaltyWeight);
        if (usernameDigitRatio > 0.35) contentScore -= 12;
        else if (usernameDigitRatio > 0.2) contentScore -= 6;
        if (/bot|spam|free|follow|support|loan|recovery/i.test(username)) contentScore -= 12;
        if (explicitImpersonationSignal) contentScore -= 24;
        else if (weakImpersonationSignal) contentScore -= 10;
        if (bioLength >= 20) contentScore += 10;
        else if (bioLength >= 8) contentScore += 5;
        else if (bioLength === 0) contentScore -= 10;
        if (linkMatches === 0 && suspiciousLinkMatches === 0 && keywordHits === 0) contentScore += 8;
        const scamLikeUsername = /bot|spam|free|follow|support|loan|recovery/i.test(username);
        const lowScamEvidence = keywordHits === 0 && suspiciousLinkMatches === 0 && !scamLikeUsername;
        if (data.verified === true && followerCount >= 1_000_000 && lowScamEvidence) {
            if (entityBaseline.entityClass === 'public_figure') contentScore = Math.max(contentScore, 62);
            else if (entityBaseline.entityClass === 'hybrid_creator') contentScore = Math.max(contentScore, 60);
            else if (entityBaseline.entityClass === 'corporate') contentScore = Math.max(contentScore, 58);
            else contentScore = Math.max(contentScore, 58);
        }

        // Behavioral trust score (higher = more normal activity cues).
        let behavioralScore = null;
        let behavioralEvidence = 'none';
        let behavioralConfidence = 'low';
        const posts = Array.isArray(data.posts) ? data.posts : [];
        const reels = Array.isArray(data.reels) ? data.reels : [];
        const mediaItemsRaw = [...posts, ...reels].map((item) => normalizeMediaItemForScoring(item));
        const mediaItemsByRecency = [...mediaItemsRaw].sort((a, b) => {
            const aTs = extractMediaTimestampSeconds(a) || 0;
            const bTs = extractMediaTimestampSeconds(b) || 0;
            return bTs - aTs;
        });
        const targetMediaSampleSize = followerCount >= 1_000_000 ? 20 : 16;
        let mediaItems = mediaItemsByRecency.slice(0, targetMediaSampleSize);
        setPhaseStatus('Collecting media metrics');
        const cachedEnrichment = await getCachedProfileEnrichment(data.username);
        const enrichmentResult = await requestMediaMetricEnrichment(mediaItems, targetMediaSampleSize);
        const liveEnrichedMetrics = Array.isArray(enrichmentResult.items) ? enrichmentResult.items : [];
        const hasLiveEnrichment = liveEnrichedMetrics.length > 0;
        const shouldUseCachedEnrichment =
            cachedEnrichment &&
            (
                (enrichmentResult?.diagnostics?.rateLimited === true && !hasLiveEnrichment) ||
                (!hasLiveEnrichment && Number(enrichmentResult?.diagnostics?.detailsFetched || 0) === 0)
            );
        const enrichedMetrics = shouldUseCachedEnrichment
            ? mergeEnrichmentItems(liveEnrichedMetrics, cachedEnrichment.items)
            : liveEnrichedMetrics;
        if (hasLiveEnrichment) {
            setCachedProfileEnrichment(data.username, {
                items: liveEnrichedMetrics,
                diagnostics: enrichmentResult?.diagnostics || {},
            }).catch((error) => {
                console.warn('[Instagram Authentication] Failed to persist enrichment cache:', error);
            });
        }
        const enrichmentDiagnostics = {
            ...(enrichmentResult.diagnostics || {}),
            urlsCollected: mediaItems.length,
            detailsFetched: Math.max(
                Number(enrichmentResult?.diagnostics?.detailsFetched || 0),
                enrichedMetrics.length
            ),
            interactionsComputed: Math.max(
                Number(enrichmentResult?.diagnostics?.interactionsComputed || 0),
                shouldUseCachedEnrichment
                    ? Number(cachedEnrichment?.diagnostics?.interactionsComputed || 0)
                    : 0
            ),
            timestampExtractionAttempts: Math.max(
                Number(enrichmentResult?.diagnostics?.timestampExtractionAttempts || 0),
                Number(enrichmentResult?.diagnostics?.requestedUrlCount || 0),
                shouldUseCachedEnrichment
                    ? Number(cachedEnrichment?.diagnostics?.timestampExtractionAttempts || 0)
                    : 0
            ),
            timestampExtractionSuccesses: Math.max(
                Number(enrichmentResult?.diagnostics?.timestampExtractionSuccesses || 0),
                shouldUseCachedEnrichment
                    ? Number(cachedEnrichment?.diagnostics?.timestampExtractionSuccesses || 0)
                    : 0
            ),
            collectAttempts: Number(enrichmentResult?.diagnostics?.collectAttempts || 0),
            reusedCachedEnrichment: shouldUseCachedEnrichment === true,
            cacheAgeMs: shouldUseCachedEnrichment && cachedEnrichment
                ? Math.max(0, Date.now() - Number(cachedEnrichment.updatedAtMs || Date.now()))
                : null,
            cacheUpdatedAtMs: shouldUseCachedEnrichment && cachedEnrichment
                ? Number(cachedEnrichment.updatedAtMs || 0)
                : null,
        };
        if (
            profileKeyForEnrichment &&
            enrichmentDiagnostics.rateLimited === true &&
            Number(enrichmentDiagnostics.detailsFetched || 0) === 0
        ) {
            await enqueueProfileEnrichmentRetry(profileKeyForEnrichment, 'rate_limited_empty_enrichment');
        }
        let enrichedSampleCount = 0;
        if (enrichedMetrics.length > 0) {
            const byUrl = new Map(
                enrichedMetrics
                    .map((item) => [normalizeMediaEvidenceUrl(item?.url), item])
                    .filter(([key]) => Boolean(key))
            );
            mediaItems = mediaItems.map((item) => {
                const details = byUrl.get(normalizeMediaEvidenceUrl(item?.url));
                if (!details) return item;
                enrichedSampleCount += 1;
                return {
                    ...item,
                    likeCount: details.likeCount ?? item.likeCount,
                    commentCount: details.commentCount ?? item.commentCount,
                    viewCount: details.viewCount ?? item.viewCount,
                    takenAtTimestamp: details.takenAtTimestamp ?? details.taken_at_timestamp ?? item.takenAtTimestamp ?? item.taken_at_timestamp ?? null,
                    caption: (String(details.caption || '').trim() || item.caption || item.captionText || item.caption_text || ''),
                    commentUsernames: Array.isArray(details.commentUsernames)
                        ? details.commentUsernames
                        : (Array.isArray(item.commentUsernames) ? item.commentUsernames : []),
                };
            });
        }
        const captions = mediaItems.map((p) => extractMediaCaption(p).toLowerCase()).filter(Boolean);
        const captionLengths = captions.map((c) => c.length);
        const uniqueCaptions = new Set(captions).size;
        const captionDiversity = captions.length > 0 ? (uniqueCaptions / captions.length) : 0;
        const promotionTerms = ['dm', 'offer', 'join', 'guaranteed', 'link in bio', 'earn', 'giveaway', 'claim now'];
        const toxicTerms = ['hate', 'stupid', 'scam', 'fuck', 'idiot', 'kill'];
        let promotionHits = 0;
        let toxicHits = 0;
        captions.forEach((text) => {
            promotionTerms.forEach((term) => { if (text.includes(term)) promotionHits += 1; });
            toxicTerms.forEach((term) => { if (text.includes(term)) toxicHits += 1; });
        });

        const engagementRates = [];
        const likeRates = [];
        const commentRates = [];
        const commentLikeRatios = [];
        const commentUsers = [];
        let interactionSamples = 0;
        mediaItems.forEach((item) => {
            const likes = extractMediaMetric(item, 'likes');
            const comments = extractMediaMetric(item, 'comments');
            const views = extractMediaMetric(item, 'views');
            const interactions = (likes || 0) + (comments || 0) + ((views || 0) * 0.02);
            if (interactions > 0 && followerCount > 0) {
                interactionSamples += 1;
                engagementRates.push((interactions / followerCount) * 100);
            }
            if (Number.isFinite(likes) && followerCount > 0) {
                likeRates.push((likes / followerCount) * 100);
            }
            if (Number.isFinite(comments) && followerCount > 0) {
                commentRates.push((comments / followerCount) * 100);
            }
            if (likes && likes > 0 && Number.isFinite(comments)) {
                commentLikeRatios.push(comments / likes);
            }
            if (Array.isArray(item.commentUsernames)) {
                item.commentUsernames.forEach((username) => {
                    const normalized = String(username || '').trim().toLowerCase();
                    if (normalized) commentUsers.push(normalized);
                });
            }
        });
        const avgEngagement = average(engagementRates);
        const medianEngagement = median(engagementRates);
        const engagementStdDev = standardDeviation(engagementRates);
        const avgLikeRate = average(likeRates);
        const likeRateStdDev = standardDeviation(likeRates);
        const avgCommentRate = average(commentRates);
        const commentRateStdDev = standardDeviation(commentRates);
        const avgCommentLikeRatio = average(commentLikeRatios);
        const uniqueCommentUsers = new Set(commentUsers).size;
        const commentUniquenessRatio = commentUsers.length > 0 ? (uniqueCommentUsers / commentUsers.length) : 0;
        const timestampsSec = mediaItems
            .map((item) => extractMediaTimestampSeconds(item))
            .filter((n) => Number.isFinite(n));
        const postingIntervalsDays = computeIntervalDays(timestampsSec);
        const avgPostingFrequencyDays = postingIntervalsDays.length > 0 ? average(postingIntervalsDays) : null;
        const postingFrequencyStdDev = postingIntervalsDays.length > 1 ? standardDeviation(postingIntervalsDays) : null;
        const postingIntervalMedianDays = postingIntervalsDays.length > 0 ? median(postingIntervalsDays) : null;
        const postingIntervalIqrDays = postingIntervalsDays.length > 1
            ? (quantile(postingIntervalsDays, 0.75) - quantile(postingIntervalsDays, 0.25))
            : null;
        const sortedTimestamps = [...timestampsSec].sort((a, b) => a - b);
        const oldestTimestamp = sortedTimestamps.length > 0 ? sortedTimestamps[0] : null;
        const newestTimestamp = sortedTimestamps.length > 0 ? sortedTimestamps[sortedTimestamps.length - 1] : null;
        const hasTimestampEvidence = sortedTimestamps.length > 0;
        const temporalSampleCoverageRatio = postCount > 0 ? Math.min(1, mediaItems.length / postCount) : 0;
        const lifecycleInactivityInferable =
            hasTimestampEvidence &&
            (
                postCount <= (mediaItems.length + 2) ||
                temporalSampleCoverageRatio >= 0.6
            );
        const nowSec = Math.floor(Date.now() / 1000);
        const onlineContinuity = computeOnlineContinuity(timestampsSec, nowSec);
        let accountAgeDays = oldestTimestamp ? Math.max(1, (nowSec - oldestTimestamp) / 86400) : 0;
        let activeSpanDays = (oldestTimestamp && newestTimestamp) ? Math.max(1, (newestTimestamp - oldestTimestamp) / 86400) : 0;
        const dayBuckets = new Set(sortedTimestamps.map((ts) => Math.floor(ts / 86400)));
        let activeDays = dayBuckets.size;
        const sparseTemporalEvidence = sortedTimestamps.length < 3;
        let temporalEstimateUsed = false;
        if (postCount > 0 && (accountAgeDays <= 0 || sparseTemporalEvidence)) {
            const expectedCadenceMid = average([
                entityBaseline.expectedCadenceDays.min,
                entityBaseline.expectedCadenceDays.max,
            ]);
            const cadenceEstimateDays = clampNumber(postCount * Math.max(1.5, expectedCadenceMid), 45, 3650);
            const volumeEstimateDays = clampNumber(postCount * 2, 45, 3650);
            const temporalFallbackDays = Math.max(cadenceEstimateDays, volumeEstimateDays);
            accountAgeDays = Math.max(accountAgeDays, temporalFallbackDays);
            temporalEstimateUsed = true;
        }
        if (activeSpanDays > 0) accountAgeDays = Math.max(accountAgeDays, activeSpanDays);
        let inactiveDays = (lifecycleInactivityInferable && accountAgeDays > 0) ? Math.max(0, accountAgeDays - activeDays) : null;
        let inactivityRatio = (lifecycleInactivityInferable && accountAgeDays > 0 && Number.isFinite(inactiveDays))
            ? (inactiveDays / accountAgeDays)
            : null;
        if ((temporalEstimateUsed && sparseTemporalEvidence) || !lifecycleInactivityInferable) {
            inactiveDays = null;
            inactivityRatio = null;
        }
        const postsPerActiveDay = activeDays > 0 ? (postCount / activeDays) : null;
        const postsPerDay = accountAgeDays > 0 ? (postCount / accountAgeDays) : 0;
        const followerGrowthPerDayProxy = accountAgeDays > 0 ? (followerCount / accountAgeDays) : 0;
        const postingRecencyDays = Number.isFinite(newestTimestamp)
            ? Math.max(0, (nowSec - newestTimestamp) / 86400)
            : null;
        const postingHours = sortedTimestamps.map((ts) => new Date(ts * 1000).getUTCHours());
        const activityTimeEntropy = shannonEntropy(postingHours);
        const normalizedFollowerFollowingRatio = Math.log10((followerCount + 1) / (followingCount + 1));
        const interactionDensity = mediaItems.length > 0 ? (interactionSamples / mediaItems.length) : 0;
        const requiredInteractionSamples = followerCount >= 1_000_000
            ? 10
            : PROFILE_EVIDENCE_POLICY.minInteractionSamples;
        const maxCollectibleRecentMediaSamples = 12;
        const requiredRecentMediaSamples = followerCount >= 1_000_000
            ? maxCollectibleRecentMediaSamples
            : Math.min(maxCollectibleRecentMediaSamples, 10);
        const tier3MinMediaSamples = followerCount >= 10_000_000 ? 12 : requiredRecentMediaSamples;
        const isPrivateProfile = data.private === true;
        const behavioralUnavailable = isPrivateProfile || interactionSamples < requiredInteractionSamples;
        const engagementCv = avgEngagement > 0 ? (engagementStdDev / avgEngagement) : null;
        const likeCv = avgLikeRate > 0 ? (likeRateStdDev / avgLikeRate) : null;
        const commentCv = avgCommentRate > 0 ? (commentRateStdDev / avgCommentRate) : null;
        const frequencyCv = avgPostingFrequencyDays > 0 ? (postingFrequencyStdDev / avgPostingFrequencyDays) : null;
        const cadenceStability = postingIntervalMedianDays > 0
            ? (postingIntervalIqrDays / Math.max(0.25, postingIntervalMedianDays))
            : null;
        const inactivityRiskSignal =
            accountAgeDays >= 120 &&
            Number.isFinite(inactiveDays) &&
            inactiveDays >= 90 &&
            Number.isFinite(inactivityRatio) &&
            inactivityRatio >= 0.82 &&
            Number.isFinite(postingRecencyDays) &&
            postingRecencyDays >= 90 &&
            postCount >= 20;
        const sustainedActivitySignal =
            accountAgeDays >= 90 &&
            activeDays >= 35 &&
            Number.isFinite(inactivityRatio) &&
            inactivityRatio <= 0.6 &&
            Number.isFinite(postingRecencyDays) &&
            postingRecencyDays <= 30;

        if (!behavioralUnavailable) {
            behavioralScore = 50;
            const engagementBandScore = scoreWithinBand(
                avgEngagement,
                entityBaseline.expectedEngagement.min,
                entityBaseline.expectedEngagement.max,
                1.6
            );
            behavioralScore += engagementBandScore * 14;

            const commentBandScore = scoreWithinBand(
                avgCommentLikeRatio,
                entityBaseline.expectedCommentLike.min,
                entityBaseline.expectedCommentLike.max,
                2
            );
            behavioralScore += commentBandScore * 10;

            if (postingIntervalsDays.length >= 4) {
                const cadenceBandScore = scoreWithinBand(
                    postingIntervalMedianDays,
                    entityBaseline.expectedCadenceDays.min,
                    entityBaseline.expectedCadenceDays.max,
                    1.8
                );
                behavioralScore += cadenceBandScore * 12;
                if (cadenceStability <= 1.3) behavioralScore += 8;
                else if (cadenceStability <= 2.2) behavioralScore += 3;
                else behavioralScore -= 8;
                if (frequencyCv <= 1.25) behavioralScore += 5;
                else if (frequencyCv > 2.8) behavioralScore -= 6;
            }

            if (Number.isFinite(engagementCv)) {
                if (engagementCv <= entityBaseline.expectedEngagementCvMax * 0.55) behavioralScore += 10;
                else if (engagementCv <= entityBaseline.expectedEngagementCvMax) behavioralScore += 4;
                else behavioralScore -= 10;
            }
            if (Number.isFinite(likeCv)) {
                if (likeCv <= 2.2) behavioralScore += 4;
                else behavioralScore -= 3;
            }
            if (Number.isFinite(commentCv)) {
                if (commentCv <= 3.2) behavioralScore += 3;
                else behavioralScore -= 3;
            }

            if (captionDiversity >= 0.75) behavioralScore += 8;
            else if (captionDiversity < 0.4 && captions.length >= 5) behavioralScore -= 8;

            const avgCaptionLen = average(captionLengths);
            if (avgCaptionLen >= 15 && avgCaptionLen <= 280) behavioralScore += 6;
            else if (avgCaptionLen > 0 && avgCaptionLen < 8) behavioralScore -= 5;

            behavioralScore -= Math.min(12, promotionHits * 2);
            behavioralScore -= Math.min(10, toxicHits * 2);

            if (commentUsers.length >= 20) {
                if (commentUniquenessRatio >= 0.45) behavioralScore += 6;
                else if (commentUniquenessRatio < 0.2) behavioralScore -= 7;
            }
            if (Number.isFinite(postingRecencyDays) && postingRecencyDays <= 14) behavioralScore += 5;
            else if (Number.isFinite(postingRecencyDays) && postingRecencyDays > 180) behavioralScore -= 8;
            if (interactionDensity >= 0.75) behavioralScore += 4;
            else if (interactionDensity < 0.3) behavioralScore -= 6;
            if (activeSpanDays > 0 && activeSpanDays < 45 && postCount > 200) behavioralScore -= 8;
            if (postsPerDay > 0 && postsPerDay <= 5) behavioralScore += 3;
            else if (postsPerDay > 10) behavioralScore -= 7;

            if (institutionalType === 'science') behavioralScore += 3;
            else if (institutionalType === 'international') behavioralScore += 2;
            if (institutionalType === 'governance' && persuasionHits > 0) behavioralScore -= Math.min(6, persuasionHits * 2);

            if (inactivityRiskSignal) behavioralScore -= 8;
            if (sustainedActivitySignal) behavioralScore += 4;

            if (interactionSamples >= 12 && postingIntervalsDays.length >= 8 && captions.length >= 8) {
                behavioralEvidence = 'full';
                behavioralConfidence = 'high';
            } else if (interactionSamples >= 8 && (postingIntervalsDays.length >= 5 || captions.length >= 5)) {
                behavioralEvidence = 'medium';
                behavioralConfidence = 'medium';
            } else {
                behavioralEvidence = 'basic';
                behavioralConfidence = 'low-medium';
            }

            // Re-center behavioral score around evidence depth so small samples cannot appear over-certain.
            const highConfidenceSampleTarget = followerCount >= 1_000_000 ? 40 : 28;
            const interactionCoverage = clampNumber(
                (interactionSamples - requiredInteractionSamples) / Math.max(1, highConfidenceSampleTarget - requiredInteractionSamples),
                0,
                1
            );
            const mediaCoverage = clampNumber(
                mediaItems.length / (followerCount >= 1_000_000 ? 30 : 20),
                0.2,
                1
            );
            const sampleDepthFactor = clampNumber(
                0.25 + (0.75 * Math.min(interactionCoverage, mediaCoverage)),
                0.25,
                1
            );
            behavioralScore = 50 + ((behavioralScore - 50) * sampleDepthFactor);
            if (!data.verified && interactionSamples < highConfidenceSampleTarget) {
                behavioralScore = clampNumber(behavioralScore, 32, 74);
            }
            if (explicitImpersonationSignal) {
                behavioralScore = Math.min(behavioralScore, 48);
            }
            if (followerCount >= 5_000_000 && mediaItems.length <= 20) {
                behavioralScore = Math.min(behavioralScore, 84);
            }
        }

        setPhaseStatus('Computing trust scores');
        const mediaAccessRestricted = isPrivateProfile && postCount > 0 && mediaItems.length === 0;
        const hasDerivedInteractionEvidence =
            interactionSamples > 0 ||
            avgEngagement > 0 ||
            avgLikeRate > 0 ||
            avgCommentRate > 0;
        const hasUrlSampleMediaEvidence =
            !isPrivateProfile &&
            (
                mediaItems.length >= tier3MinMediaSamples ||
                Number(enrichmentDiagnostics.urlsCollected || 0) >= tier3MinMediaSamples
            );
        const hasDerivedMediaEvidence =
            hasDerivedInteractionEvidence ||
            captions.length > 0 ||
            hasTimestampEvidence ||
            hasUrlSampleMediaEvidence;
        const mediaEvidenceAvailable =
            !mediaAccessRestricted &&
            (
                (enrichmentDiagnostics.detailsFetched || 0) > 0 ||
                (enrichmentDiagnostics.interactionsComputed || 0) > 0 ||
                hasDerivedMediaEvidence
            );
        const scrapeDiagnostics = (data && typeof data.scrapeDiagnostics === 'object') ? data.scrapeDiagnostics : {};
        const tier1ProfileSignalsAvailable =
            Number.isFinite(Number(followerCount)) &&
            Number.isFinite(Number(followingCount)) &&
            Number.isFinite(Number(postCount)) &&
            (data.verified === true || data.verified === false);
        const tier2NetworkSignalsAvailable =
            data.scrapeSource === 'network_api' ||
            (
                Number.isFinite(Number(scrapeDiagnostics?.networkStats?.followers)) &&
                Number.isFinite(Number(scrapeDiagnostics?.networkStats?.following)) &&
                Number.isFinite(Number(scrapeDiagnostics?.networkStats?.postCount))
            );
        const tier3MediaEvidenceAvailable =
            mediaEvidenceAvailable &&
            (
                hasTimestampEvidence ||
                captions.length > 0 ||
                (enrichmentDiagnostics.detailsFetched || 0) > 0 ||
                hasUrlSampleMediaEvidence
            );
        const tier4InteractionSignalsAvailable =
            !behavioralUnavailable &&
            (
                interactionSamples >= PROFILE_EVIDENCE_POLICY.minInteractionSamples ||
                (enrichmentDiagnostics.interactionsComputed || 0) > 0
            );
        const tier4TemporalEvidenceAvailable = hasTimestampEvidence && timestampsSec.length >= 2;
        const tier4InteractionEvidenceAvailable =
            tier4InteractionSignalsAvailable &&
            tier4TemporalEvidenceAvailable;
        const tier4PartialEvidenceAvailable =
            !tier4InteractionEvidenceAvailable &&
            !isPrivateProfile &&
            (
                tier4InteractionSignalsAvailable ||
                (
                    enrichmentDiagnostics.rateLimited === true &&
                    (enrichmentDiagnostics.detailsFetched || 0) > 0 &&
                    hasUrlSampleMediaEvidence &&
                    mediaItems.length >= tier3MinMediaSamples
                )
            );
        const tierEvidenceWeights = { t1: 0.3, t2: 0.25, t3: 0.25, t4: 0.2 };
        const tierEvidenceCoverage = clampNumber(
            (tier1ProfileSignalsAvailable ? tierEvidenceWeights.t1 : 0) +
            (tier2NetworkSignalsAvailable ? tierEvidenceWeights.t2 : 0) +
            (tier3MediaEvidenceAvailable ? tierEvidenceWeights.t3 : 0) +
            (tier4InteractionEvidenceAvailable
                ? tierEvidenceWeights.t4
                : (tier4PartialEvidenceAvailable ? (tierEvidenceWeights.t4 * 0.5) : 0)),
            0,
            1
        );
        const tierAvailability = {
            tier1ProfileSignalsAvailable,
            tier2NetworkSignalsAvailable,
            tier3MediaEvidenceAvailable,
            tier4InteractionEvidenceAvailable,
            tier4TemporalEvidenceAvailable,
            tier4InteractionSignalsAvailable,
            tier4PartialEvidenceAvailable,
            tierEvidenceCoverage,
            tierAvailabilityCount: [
                tier1ProfileSignalsAvailable,
                tier2NetworkSignalsAvailable,
                tier3MediaEvidenceAvailable,
                tier4InteractionEvidenceAvailable,
            ].filter(Boolean).length,
        };
        // Deterministic photo scoring with binary-weighted signals.
        const normalizedAccountType = String(data.accountType || '').toLowerCase();
        const professionalTypeHint =
            normalizedAccountType.includes('business') ||
            normalizedAccountType.includes('professional') ||
            normalizedAccountType.includes('creator');
        const photoSignals = {
            hasClearIdentityPhoto: data.hasProfilePic === true,
            hasProfessionalIdentityCue: (data.verified === true) || professionalTypeHint || institutionalType !== 'general',
            hasNoDistortionProxy:
                mediaEvidenceAvailable &&
                enrichedSampleCount >= 4 &&
                interactionDensity >= 0.35 &&
                captionDiversity >= 0.35,
            hasStrongMediaSupport:
                mediaItems.length >= 12 &&
                (enrichmentDiagnostics.detailsFetched || 0) >= 4,
        };
        let photoScore = 0;
        if (photoSignals.hasClearIdentityPhoto) photoScore += 38;
        else photoScore -= 22;
        if (photoSignals.hasProfessionalIdentityCue) photoScore += 24;
        if (photoSignals.hasNoDistortionProxy) photoScore += 20;
        else if (mediaEvidenceAvailable) photoScore -= 6;
        if (photoSignals.hasStrongMediaSupport) photoScore += 18;
        else if (!mediaEvidenceAvailable && !mediaAccessRestricted) photoScore -= 10;
        photoScore += clampNumber(Math.round(Math.log10(postCount + 1) * 4), 0, 8);

        if (Number.isFinite(postingRecencyDays) && postingRecencyDays > 180 && postCount > 50) structuralScore -= 8;
        else if (Number.isFinite(postingRecencyDays) && postingRecencyDays <= 14 && postCount > 20) structuralScore += 2;
        if (postsPerDay > 0 && postsPerDay <= 3.5) structuralScore += 2;
        else if (postsPerDay > 10) structuralScore -= 8;
        if (inactivityRiskSignal && !data.verified) structuralScore -= 10;
        else if (sustainedActivitySignal) structuralScore += 4;
        if (activeSpanDays >= 365) structuralScore += 2;
        else if (activeSpanDays > 0 && activeSpanDays < 30 && followerCount > 100_000) structuralScore -= 8;
        if (!data.verified && followerCount >= 5_000_000 && followingCount <= 3) structuralScore -= 8;
        else if (!data.verified && followerCount >= 5_000_000 && followingCount <= 10) structuralScore -= 4;
        if (!data.verified && ratio > 20_000 && followingCount < 50) structuralScore -= 8;

        const privateContentUnavailable = mediaAccessRestricted && isPrivateProfile;
        structuralScore = Math.min(100, Math.max(0, Math.round(structuralScore)));
        contentScore = privateContentUnavailable ? null : Math.min(100, Math.max(0, Math.round(contentScore)));
        behavioralScore = Number.isFinite(behavioralScore) ? Math.min(100, Math.max(0, Math.round(behavioralScore))) : null;
        photoScore = Math.min(100, Math.max(0, Math.round(photoScore)));
        const weightProfile = behavioralEvidence === 'full'
            ? TRUST_WEIGHT_PROFILES.full
            : (behavioralEvidence === 'medium'
                ? TRUST_WEIGHT_PROFILES.medium
                : (behavioralEvidence === 'basic'
                    ? TRUST_WEIGHT_PROFILES.basic
                    : TRUST_WEIGHT_PROFILES.none));
        const scoreParts = [
            { key: 'structural', value: structuralScore, weight: weightProfile.structural },
            { key: 'content', value: Number.isFinite(contentScore) ? contentScore : null, weight: weightProfile.content },
            { key: 'behavioral', value: behavioralScore, weight: weightProfile.behavioral },
            { key: 'photo', value: photoScore, weight: weightProfile.photo },
        ];
        const computedParts = scoreParts.filter((p) => Number.isFinite(p.value));
        const availableWeight = computedParts.reduce((sum, p) => sum + p.weight, 0);
        const weightedTrust = availableWeight > 0
            ? Math.round(computedParts.reduce((sum, p) => sum + (p.value * p.weight), 0) / availableWeight)
            : 0;
        const baseSignalsObserved = [
            Number.isFinite(followerCount),
            Number.isFinite(followingCount),
            Number.isFinite(postCount),
            typeof data.private === 'boolean',
            data.hasProfilePic === true || data.hasProfilePic === false,
            bioLength > 0,
        ].filter(Boolean).length;
        const structuralEvidenceCoverage = baseSignalsObserved / 6;
        const contentEvidenceCoverage = mediaEvidenceAvailable
            ? clampNumber(
                (
                    ((enrichmentDiagnostics.detailsFetched || 0) > 0 ? 1 : 0) +
                    (captions.length > 0 ? 1 : 0) +
                    (mediaItems.length >= requiredRecentMediaSamples ? 1 : 0)
                ) / 3,
                0,
                1
            )
            : 0;
        const interactionEvidenceCoverage = clampNumber(
            (
                ((enrichmentDiagnostics.interactionsComputed || 0) > 0 ? 1 : 0) +
                (interactionSamples >= PROFILE_EVIDENCE_POLICY.minInteractionSamples ? 1 : 0)
            ) / 2,
            0,
            1
        );
        const temporalEvidenceCoverage = clampNumber(
            (
                (postingIntervalsDays.length >= 2 ? 1 : 0) +
                (activeDays > 0 ? 1 : 0)
            ) / 2,
            0,
            1
        );
        const rawDataCompleteness = clampNumber(
            (0.35 * structuralEvidenceCoverage) +
            (0.25 * contentEvidenceCoverage) +
            (0.25 * interactionEvidenceCoverage) +
            (0.15 * temporalEvidenceCoverage),
            0,
            1
        );
        let dataCompleteness = clampNumber(
            (0.65 * rawDataCompleteness) + (0.35 * tierEvidenceCoverage),
            0,
            1
        );
        if (privateContentUnavailable) {
            dataCompleteness = Math.min(dataCompleteness, 0.3);
        }
        if (tier1ProfileSignalsAvailable && tier2NetworkSignalsAvailable && !tier3MediaEvidenceAvailable && !tier4InteractionEvidenceAvailable) {
            dataCompleteness = Math.max(dataCompleteness, 0.35);
        }
        dataCompleteness = Number(dataCompleteness.toFixed(2));
        const behavioralDepth = behavioralEvidence === 'full' ? 1 : (behavioralEvidence === 'medium' ? 0.75 : (behavioralEvidence === 'basic' ? 0.55 : 0.1));
        const structuralStrength = structuralScore / 100;
        const recentMediaCoverage =
            mediaItems.length >= 20 ? 1 :
            mediaItems.length >= 12 ? 0.75 :
            mediaItems.length >= 8 ? 0.55 :
            0.35;
        const requiresBehavioralValidation = followerCount > 1_000_000 && followingCount < 15;
        const behavioralRequired =
            followerCount >= TRUST_POLICY.ratioBehaviorGate.minFollowers &&
            ratio >= TRUST_POLICY.ratioBehaviorGate.minFollowerFollowingRatio &&
            institutionalConfidenceScore < TRUST_POLICY.ratioBehaviorGate.maxInstitutionalConfidenceWithoutBehavior;
        const explicitScamSignalScore =
            (keywordHits * 2) +
            (suspiciousLinkMatches * 3) +
            ((/bot|spam|free|follow|support|loan|recovery/i.test(username)) ? 2 : 0) +
            Math.min(3, persuasionHits) +
            (explicitImpersonationSignal ? 5 : (weakImpersonationSignal ? 2 : 0));
        const explicitScamSignals = explicitScamSignalScore >= 5 || explicitImpersonationSignal;
        const evidenceConstrainedInstitutional =
            data.verified === true &&
            followerCount >= 500_000 &&
            followingCount > 0 &&
            followingCount <= 25 &&
            postCount >= 100 &&
            institutionalConfidenceScore >= 60 &&
            !explicitScamSignals;
        let confidenceScore = clampNumber(
            (0.35 * dataCompleteness) + (0.25 * behavioralDepth) + (0.2 * structuralStrength) + (0.2 * recentMediaCoverage),
            0,
            1
        );
        confidenceScore = clampNumber((0.6 * confidenceScore) + (0.4 * tierEvidenceCoverage), 0, 1);
        let confidenceLimit = null;
        const sampleCoverageRatio = postCount > 0 ? Math.min(1, mediaItems.length / postCount) : 0;
        if (!evidenceConstrainedInstitutional) {
            if (followerCount >= 100_000_000 && mediaItems.length <= 20) {
                confidenceScore = Math.min(confidenceScore, 0.84);
                confidenceLimit = 'shallow_sample_for_mega_reach';
            } else if (followerCount >= 10_000_000 && mediaItems.length <= 20) {
                confidenceScore = Math.min(confidenceScore, 0.86);
                confidenceLimit = 'shallow_sample_for_high_reach';
            } else if (followerCount >= 1_000_000 && mediaItems.length <= 20) {
                confidenceScore = Math.min(confidenceScore, 0.88);
                confidenceLimit = 'shallow_sample_for_large_reach';
            }
            if (followerCount >= 1_000_000) {
                if (sampleCoverageRatio < 0.01) {
                    confidenceScore = Math.min(confidenceScore, 0.84);
                    confidenceLimit = 'very_low_profile_sample_coverage';
                } else if (sampleCoverageRatio < 0.03) {
                    confidenceScore = Math.min(confidenceScore, 0.88);
                    confidenceLimit = 'low_profile_sample_coverage';
                }
            }
        }
        if (mediaItems.length < requiredRecentMediaSamples) {
            confidenceScore = Math.min(confidenceScore, 0.7);
            confidenceLimit = 'insufficient_recent_media_sample';
        }
        if (behavioralUnavailable) {
            confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.68 : 0.55);
            confidenceLimit = 'missing_behavioral_evidence';
        }
        if (requiresBehavioralValidation && behavioralUnavailable) {
            confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.64 : 0.5);
            confidenceLimit = 'behavior_required_for_extreme_ratio';
        }
        if (behavioralRequired && behavioralUnavailable) {
            confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.62 : 0.45);
            confidenceLimit = 'behavior_required_for_ratio_without_institutional_confidence';
        }
        if (tier1ProfileSignalsAvailable && tier2NetworkSignalsAvailable && !tier3MediaEvidenceAvailable && !tier4InteractionEvidenceAvailable) {
            confidenceScore = Math.min(confidenceScore, 0.68);
            confidenceLimit = confidenceLimit || 'tier3_tier4_unavailable';
        } else if (tier1ProfileSignalsAvailable && tier2NetworkSignalsAvailable && tier3MediaEvidenceAvailable && !tier4InteractionEvidenceAvailable) {
            confidenceScore = Math.min(confidenceScore, 0.78);
            confidenceLimit = confidenceLimit || 'tier4_unavailable';
        } else if (!tier1ProfileSignalsAvailable || !tier2NetworkSignalsAvailable) {
            confidenceScore = Math.min(confidenceScore, 0.52);
            confidenceLimit = confidenceLimit || 'tier1_tier2_unavailable';
        }
        if (
            dataCompleteness >= 0.7 &&
            tierEvidenceCoverage >= 0.85 &&
            !behavioralUnavailable &&
            !explicitScamSignals &&
            !explicitImpersonationSignal
        ) {
            confidenceScore = Math.max(confidenceScore, 0.82);
        }
        const trustComponentsForSpread = [structuralScore, photoScore];
        if (Number.isFinite(contentScore)) trustComponentsForSpread.push(contentScore);
        if (Number.isFinite(behavioralScore)) trustComponentsForSpread.push(behavioralScore);
        const componentSpread = standardDeviation(trustComponentsForSpread);
        const behavioralLift = Number.isFinite(behavioralScore) ? (((behavioralScore - 50) / 50) * 4 * behavioralDepth) : 0;
        let finalTrust = Math.round(
            (weightedTrust * (0.64 + (0.36 * confidenceScore))) +
            behavioralLift +
            clampNumber((componentSpread - 10) * 0.12, -3, 3)
        );
        if (!data.verified && behavioralUnavailable) {
            const fallbackCeiling = evidenceConstrainedInstitutional
                ? Math.max(72, TRUST_POLICY.behavioralTrustCeilingWithoutEvidence)
                : TRUST_POLICY.behavioralTrustCeilingWithoutEvidence;
            finalTrust = Math.min(finalTrust, fallbackCeiling);
        }
        if (!data.verified && requiresBehavioralValidation && behavioralUnavailable) {
            finalTrust = Math.min(finalTrust, evidenceConstrainedInstitutional ? 72 : 65);
        }
        if (!data.verified && behavioralRequired && behavioralUnavailable) {
            const ratioGateCeiling = evidenceConstrainedInstitutional
                ? Math.max(68, TRUST_POLICY.behavioralRequiredCeiling)
                : TRUST_POLICY.behavioralRequiredCeiling;
            finalTrust = Math.min(finalTrust, ratioGateCeiling);
        }

        // Deterministic priority order:
        // 1) Explicit scam signals 2) Behavioral anomalies 3) Institutional confidence override 4) Structural 5) Content
        const behavioralAnomaly =
            !behavioralUnavailable &&
            (
                (Number.isFinite(behavioralScore) && behavioralScore <= 38) ||
                avgEngagement < 0.01 ||
                avgCommentLikeRatio > 0.8 ||
                (Number.isFinite(engagementCv) && engagementCv > 4)
            );
        const missingBehavioralEvidence =
            behavioralUnavailable ||
            interactionSamples === 0 ||
            mediaItems.length < 8;
        const behavioralState = missingBehavioralEvidence
            ? 'unknown'
            : (behavioralAnomaly ? 'anomalous' : 'normal');
        if (explicitScamSignals) finalTrust = Math.min(finalTrust, 45);
        if (behavioralAnomaly) finalTrust = Math.min(finalTrust, 55);
        const institutionalOverrideEligible =
            !explicitScamSignals &&
            !behavioralAnomaly &&
            data.verified === true &&
            institutionalConfidenceScore >= 85;
        if (institutionalOverrideEligible && !behavioralUnavailable) {
            finalTrust = Math.max(finalTrust, 72);
        }
        if (evidenceConstrainedInstitutional && behavioralUnavailable && !behavioralAnomaly) {
            finalTrust = Math.max(finalTrust, 70);
        }
        const institutionalVeryLowRiskOverride = isInstitutionalVeryLowRiskProfile(data, {
            explicitScamSignals,
            keywordHits,
            suspiciousLinkMatches,
        }) && !behavioralAnomaly;
        if (institutionalVeryLowRiskOverride) {
            finalTrust = Math.max(finalTrust, 82);
        }
        if (privateContentUnavailable && !explicitScamSignals) {
            finalTrust = Math.max(finalTrust, 42);
        }
        if (explicitImpersonationSignal) {
            finalTrust = Math.min(finalTrust, 42);
        } else if (weakImpersonationSignal) {
            finalTrust = Math.min(finalTrust, 58);
        }
        finalTrust = clampNumber(finalTrust, 0, 100);
        const postScrapeMismatch = !isPrivateProfile && postCount > 0 && mediaItems.length === 0;
        const severeDataMissing =
            postScrapeMismatch ||
            (!mediaAccessRestricted && (enrichmentDiagnostics.detailsFetched || 0) === 0 && !hasDerivedMediaEvidence);
        const trustTier = deriveTrustTier(finalTrust, {
            confidenceScore,
            behavioralUnavailable,
            requiresBehavioralValidation,
            severeDataMissing,
            explicitScamSignals,
            explicitImpersonationSignal,
            verified: data.verified === true,
            followers: followerCount,
            accountType: data.accountType,
            entityClass: entityBaseline.entityClass,
            posts: postCount,
            detailsFetched: Number(enrichmentDiagnostics.detailsFetched || 0),
            interactionSamples,
            dataCompleteness,
        });
        const identityValidity = deriveIdentityValidity({
            verified: data.verified === true,
            followers: followerCount,
            confidenceScore,
        });
        const behavioralNormality = deriveBehavioralNormality({
            behavioralState,
            behavioralScore,
        });
        const validAccountClass = deriveValidAccountClass({
            verified: data.verified === true,
            followers: followerCount,
            posts: postCount,
            accountType: data.accountType,
            institutionalType,
            ratio,
        });
        const uncertaintyPenalty = missingBehavioralEvidence ? 6 : 0;
        const negativeSignalPenalty =
            explicitImpersonationSignal ? 24 :
            explicitScamSignals ? 22 :
            (behavioralAnomaly ? 12 : 0);
        const inactivityPenalty = inactivityRiskSignal ? 8 : 0;
        const engagementWithinBaseline =
            avgEngagement >= entityBaseline.expectedEngagement.min &&
            avgEngagement <= entityBaseline.expectedEngagement.max;
        const noCommentBotPattern =
            commentUsers.length === 0 ||
            (commentUniquenessRatio >= 0.25 && uniqueCommentUsers >= 10);
        const institutionalRiskCapEligible =
            data.verified === true &&
            followerCount >= 1_000_000 &&
            followingCount > 0 &&
            followingCount <= 50 &&
            engagementWithinBaseline &&
            institutionalConfidenceScore >= 80 &&
            !explicitScamSignals &&
            !behavioralAnomaly &&
            noCommentBotPattern;
        const eliteVerifiedGlobalProfile =
            data.verified === true &&
            followerCount >= 50_000_000 &&
            postCount >= 1000 &&
            !explicitScamSignals &&
            !explicitImpersonationSignal;
        const highTrustVerifiedBrandProfile =
            data.verified === true &&
            followerCount >= 5_000_000 &&
            postCount >= 500 &&
            !explicitScamSignals &&
            !explicitImpersonationSignal &&
            !behavioralAnomaly &&
            noCommentBotPattern &&
            (
                String(data.accountType || '').toLowerCase().includes('business') ||
                String(data.accountType || '').toLowerCase().includes('professional') ||
                String(data.accountType || '').toLowerCase().includes('creator') ||
                entityBaseline.entityClass === 'corporate'
            );
        let preliminaryRisk = clampNumber(
            Math.round((100 - finalTrust) + negativeSignalPenalty + inactivityPenalty),
            5,
            95
        );
        if (severeDataMissing && !explicitScamSignals) {
            preliminaryRisk = Math.min(preliminaryRisk, 45);
        }
        if (institutionalRiskCapEligible || institutionalVeryLowRiskOverride) {
            preliminaryRisk = Math.min(preliminaryRisk, 15);
        }
        if (eliteVerifiedGlobalProfile) {
            preliminaryRisk = Math.min(preliminaryRisk, 15);
        }
        if (highTrustVerifiedBrandProfile) {
            preliminaryRisk = Math.min(preliminaryRisk, 20);
        }
        if (privateContentUnavailable && !explicitScamSignals) {
            preliminaryRisk = Math.min(preliminaryRisk, 35);
        }
        if (explicitImpersonationSignal) {
            preliminaryRisk = Math.max(preliminaryRisk, 68);
        }
        const highTrustInstitutionalProfile =
            data.verified === true &&
            followerCount >= 1_000_000 &&
            finalTrust >= 80 &&
            institutionalType !== 'general' &&
            !explicitScamSignals &&
            !explicitImpersonationSignal;
        const highTrustEliteProfile = highTrustInstitutionalProfile || highTrustVerifiedBrandProfile || eliteVerifiedGlobalProfile;
        const missingFeatures = [];
        if (!isPrivateProfile) {
            if ((enrichmentDiagnostics.urlsCollected || 0) === 0) missingFeatures.push('media_urls_uncollected');
            if ((enrichmentDiagnostics.detailsFetched || 0) === 0 && !hasDerivedMediaEvidence) missingFeatures.push('media_details_unfetched');
            if ((enrichmentDiagnostics.interactionsComputed || 0) === 0 && !hasDerivedInteractionEvidence) missingFeatures.push('interactions_not_computed');
            if (captions.length === 0 && !highTrustEliteProfile) missingFeatures.push('caption_semantics');
            if (interactionSamples === 0 && !hasDerivedInteractionEvidence) missingFeatures.push('engagement');
            if (!hasTimestampEvidence) {
                if (!highTrustEliteProfile) missingFeatures.push('timestamp_evidence_unavailable');
            } else if (postingIntervalsDays.length < 2 && !highTrustEliteProfile) {
                missingFeatures.push('posting_frequency');
            }
        } else {
            missingFeatures.push('private_account_limited_visibility');
        }
        if (!hasNetworkRatioEvidence) missingFeatures.push('network_ratio');
        if (!isPrivateProfile && mediaItems.length < requiredRecentMediaSamples) missingFeatures.push('recent_media_sample');
        if (mediaAccessRestricted) missingFeatures.push('media_access_restricted_private');
        if (behavioralUnavailable) missingFeatures.push('behavioral_unavailable');
        if (!tier3MediaEvidenceAvailable) missingFeatures.push('tier3_media_unavailable');
        if (!tier4InteractionEvidenceAvailable && !highTrustEliteProfile) {
            missingFeatures.push(tier4PartialEvidenceAvailable ? 'tier4_interaction_partial' : 'tier4_interaction_unavailable');
        }
        if (behavioralRequired && behavioralUnavailable) missingFeatures.push('behavior_required_ratio_gate');
        if (postScrapeMismatch) missingFeatures.push('post_scrape_mismatch');
        if (severeDataMissing) missingFeatures.push('severe_data_missing');
        const observedCommentUsers = commentUsers.length;
        const observedSignals = {
            followers: followerCount,
            following: followingCount,
            posts: postCount,
            verified: data.verified === true,
            hasExternalUrl: data.hasExternalUrl === true,
            officialDomainMentions,
            captionsCount: captions.length,
            interactionSamples,
            enrichedSampleCount,
            recentMediaCount: mediaItems.length,
            sampleCoverageRatio,
            avgEngagement,
            medianEngagement,
            engagementStdDev,
            avgLikeRate,
            likeRateStdDev,
            avgCommentRate,
            commentRateStdDev,
            engagementCv,
            likeCv,
            commentCv,
            avgPostingFrequencyDays,
            postingFrequencyStdDev,
            postingIntervalMedianDays,
            postingIntervalIqrDays,
            frequencyCv,
            cadenceStability,
            avgCommentLikeRatio,
            requiresBehavioralValidation,
            behavioralRequired,
            inactivityRiskSignal,
            sustainedActivitySignal,
            institutionalConfidenceScore,
            entityBaseline,
            photoSignals,
            missingBehavioralEvidence,
            behavioralState,
            normalizedFollowerFollowingRatio,
            interactionDensity,
            temporalMetrics: {
                accountAgeDays,
                activeSpanDays,
                activeDays,
                inactiveDays,
                inactivityRatio,
                timestampSamples: timestampsSec.length,
                postsPerDay,
                postsPerActiveDay,
                followerGrowthPerDayProxy,
                postingRecencyDays,
                activityTimeEntropy,
                temporalEstimateUsed,
                hasTimestampEvidence,
                lifecycleInactivityInferable,
            },
            mediaCollectionDiagnostics: {
                urlsCollected: enrichmentDiagnostics.urlsCollected || 0,
                detailsFetched: enrichmentDiagnostics.detailsFetched || 0,
                interactionsComputed: enrichmentDiagnostics.interactionsComputed || 0,
                commentUsersObserved: observedCommentUsers,
                commentThreadsObserved: enrichmentDiagnostics.detailsFetched || mediaItems.length || 0,
                collectAttempts: enrichmentDiagnostics.collectAttempts || 0,
                retryAttempts: enrichmentDiagnostics.retryAttempts || 0,
            },
            commentUniquenessRatio,
            uniqueCommentUsers,
            totalCommentUsersObserved: observedCommentUsers,
            normalizedFollowerFollowingRatioScale: 'log10',
        };
        const inferredSignals = {
            institutionalType,
            governanceEntity,
            institutionalHits,
            scienceHits,
            governanceHits,
            internationalHits,
            persuasionHits,
            entityClass: entityBaseline.entityClass,
            ratio,
            trustTier,
            explicitScamSignals,
            explicitImpersonationSignal,
            weakImpersonationSignal,
            impersonationEntity: impersonationDetection.entity,
            impersonationSignalScore: impersonationDetection.score,
            impersonationTrigger: impersonationDetection.trigger,
            impersonationFollowerGapRatio: impersonationDetection.followerGapRatio,
            behavioralAnomaly,
            behavioralState,
            inactivityRiskSignal,
            sustainedActivitySignal,
            institutionalOverrideEligible,
            evidenceConstrainedInstitutional,
            uncertaintyPenalty,
            negativeSignalPenalty,
            identityValidity,
            behavioralNormality,
            validAccountClass: validAccountClass.code,
        };
        const profileDecision = deriveProfilePreliminaryDecision({
            structuralScore,
            contentScore,
            behavioralScore,
            photoScore,
            finalTrust,
            preliminaryRisk,
            dataCompleteness,
            behavioralEvidence,
            behavioralConfidence,
            confidenceScore,
            verified: data.verified === true,
            followers: followerCount,
            following: followingCount,
            posts: postCount,
            officialDomainMentions,
            institutionalConfidenceScore,
            behavioralUnavailable,
            interactionSamples,
            detailsFetched: enrichmentDiagnostics.detailsFetched || 0,
            explicitScamSignals,
            explicitImpersonationSignal,
            behavioralAnomaly,
            inactivityRiskSignal,
            sustainedActivitySignal,
            postScrapeMismatch,
            severeDataMissing,
            isPrivateProfile,
            tierEvidenceCoverage,
            hasTimestampEvidence,
            tier4InteractionEvidenceAvailable,
            tier4PartialEvidenceAvailable,
            hasNetworkRatioEvidence,
            captionSemanticsMissing: captions.length === 0,
        });
        console.log('[Instagram Authentication] Heuristic scoring breakdown:', {
            structuralScore,
            contentScore,
            behavioralScore,
            photoScore,
            weightedTrust,
            finalTrust,
            trustTier,
            preliminaryRisk,
            dataCompleteness,
            confidenceScore,
            behavioralDepth,
            behavioralConfidence,
            followerCount,
            followingCount,
            postCount,
            postScrapeMismatch,
            severeDataMissing,
            keywordHits,
            explicitImpersonationSignal,
            weakImpersonationSignal,
            impersonationDetection,
            institutionalHits,
            institutionalType,
            governanceEntity,
            scienceHits,
            governanceHits,
            internationalHits,
            persuasionHits,
            linkMatches,
            suspiciousLinkMatches,
            officialDomainMentions,
            behavioralEvidence,
            behavioralUnavailable,
            requiresBehavioralValidation,
            interactionSamples,
            enrichedSampleCount,
            mediaItemsCount: mediaItems.length,
            avgEngagement,
            medianEngagement,
            engagementStdDev,
            avgPostingFrequencyDays,
            postingFrequencyStdDev,
            avgCommentLikeRatio,
            accountAgeDays,
            activeDays,
            inactiveDays,
            inactivityRatio,
            postsPerActiveDay,
            confidenceLimit,
            mediaEvidenceAvailable,
            mediaAccessRestricted,
            observedSignals,
            inferredSignals,
            missingFeatures,
        });

        if (!Number.isFinite(effectiveElapsedMs)) {
            effectiveElapsedMs = endProgressTimer();
        }
        analysisDurations.clientProfileMs = effectiveElapsedMs;

        const profileStatus = getUserStatusLabel(
            mapDecisionLabelToCategory(profileDecision.label)
        );
        const accountTypeLabel = deriveAccountTypeDisplay({
            accountType: accountTypeRaw,
            institutionalType,
        });
        const profileRiskCategory = mapDecisionLabelToCategory(profileDecision.label);
        const profileRiskLevel = profileRiskCategory === 'insufficient-data'
            ? 'Unknown'
            : getRiskLevelLabel(preliminaryRisk);
        const profileConfidence = getUserConfidenceLabel(profileDecision.confidence);
        const profileReasons = [];
        const hasExternalFunnelSignals =
            suspiciousLinkMatches > 0 ||
            externalUrls.some((url) => /(t\.me|telegram|wa\.me|whatsapp|discord|linktr\.ee|bit\.ly|tinyurl|cutt\.ly|rb\.gy|goo\.gl)/i.test(String(url || '')));
        if (data.verified === true) profileReasons.push('Verified account signal detected.');
        if (followerCount >= 1_000_000) profileReasons.push('Large established follower base.');
        if (postCount >= 500) profileReasons.push('Extensive posting history supports long-term account continuity.');
        if (!explicitScamSignals) {
            if (hasExternalFunnelSignals) {
                profileReasons.push('No confirmed scam indicators detected, but external funnel signals are present.');
            } else {
                profileReasons.push('No scam indicators detected from profile signals.');
            }
        }
        if (!behavioralUnavailable && Number.isFinite(behavioralScore) && behavioralScore >= 50) {
            profileReasons.push('Observed engagement behavior appears normal.');
        }
        if (postScrapeMismatch) profileReasons.push('Post count exists but media items were not fully retrievable; risk is evidence-capped.');
        if (mediaAccessRestricted) profileReasons.push('Media access is restricted by profile privacy settings; risk is kept as unknown until richer evidence is available.');
        if (severeDataMissing) profileReasons.push('Evidence quality is limited, so classification is conservative.');
        if (explicitImpersonationSignal) profileReasons.push('Identity signals suggest possible impersonation of a public figure.');
        else if (weakImpersonationSignal) profileReasons.push('Identity naming pattern partially overlaps a known public figure; verify authenticity.');
        if (institutionalType !== 'general') profileReasons.push('Professional or institutional identity cues detected.');
        if (temporalEstimateUsed) profileReasons.push('Activity age is estimated due sparse timestamp coverage.');
        if (!lifecycleInactivityInferable) profileReasons.push('Lifetime inactivity is not inferred from limited sampled posts.');
        if (profileReasons.length === 0) profileReasons.push('Assessment is based on available public profile signals.');
        const profileReasonsMarkup = profileReasons.slice(0, 3).map((reason) => `- ${reason}`).join('<br>');
        const missingFieldsCodes = Array.from(new Set(
            (Array.isArray(missingFeatures) ? missingFeatures : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ));
        const missingFieldsLabel = missingFieldsCodes.length > 0
            ? missingFieldsCodes.map((code) => getMissingFeatureLabel(code)).join(', ')
            : 'No material missing fields detected';
        const missingFieldsListMarkup = missingFieldsCodes.length > 0
            ? missingFieldsCodes.map((code) => `- ${getMissingFeatureLabel(code)} (${code})`).join('<br>')
            : '- No material missing fields detected';
        const bioAvailableLabel = hasBioSignal((data.bio || '').trim().length) ? 'Yes' : 'No';
        const profilePicLabel = data.hasProfilePic === true ? 'Present' : 'Missing/Unclear';
        const externalLinksLabel = externalUrls.length > 0 ? `${externalUrls.length} found` : 'None';
        const scrapeCompletenessPct = Math.round(dataCompleteness * 100);
        const accountAgeLabel = Number.isFinite(accountAgeDays) && accountAgeDays > 0
            ? `${temporalEstimateUsed ? '~' : ''}${Math.round(accountAgeDays)} days`
            : 'Unavailable';
        const activeDaysLabel =
            hasTimestampEvidence && Number.isFinite(activeDays) && activeDays >= 0
                ? Math.round(activeDays)
                : 'Unavailable';
        const inactiveDaysLabel = Number.isFinite(inactiveDays) && inactiveDays >= 0
            ? Math.round(inactiveDays)
            : (temporalEstimateUsed ? 'Unavailable (estimated age only)' : 'Unavailable');
        const inactivityRatioLabel = Number.isFinite(inactivityRatio)
            ? `${Math.round(clampNumber(inactivityRatio, 0, 1) * 100)}%`
            : (temporalEstimateUsed ? 'Unavailable (estimated age only)' : 'Unavailable');
        const postingRecencyLabel = hasTimestampEvidence && Number.isFinite(postingRecencyDays)
            ? `${Math.round(postingRecencyDays)} days ago`
            : 'Unavailable';
        const postingFrequencyLabel =
            hasTimestampEvidence && Number.isFinite(avgPostingFrequencyDays)
                ? `${avgPostingFrequencyDays.toFixed(1)} days/post`
                : 'Not Scraped';
        const postsPerDayLabel =
            hasTimestampEvidence && Number.isFinite(postsPerDay)
                ? postsPerDay.toFixed(3)
                : 'Not Scraped';
        const engagementRateLabel = Number.isFinite(avgEngagement) && avgEngagement > 0
            ? `${avgEngagement.toFixed(2)}%`
            : 'Unavailable';
        const commentLikeRatioLabel = Number.isFinite(avgCommentLikeRatio) && avgCommentLikeRatio > 0
            ? avgCommentLikeRatio.toFixed(4)
            : 'Unavailable';
        const interactionDensityLabel = Number.isFinite(interactionDensity) && interactionDensity > 0
            ? interactionDensity.toFixed(2)
            : 'Unavailable';
        const interactionSamplesLabel = interactionSamples > 0 ? `${interactionSamples} available` : 'Not Scraped';
        const likeSamplesLabel = likeRates.length > 0 ? likeRates.length : 'Unavailable';
        const commentSamplesLabel = commentRates.length > 0 ? commentRates.length : 'Unavailable';
        const timestampSamplesLabel = timestampsSec.length > 0 ? timestampsSec.length : 'Unavailable';
        const detailsFetchedCount = Number(enrichmentDiagnostics.detailsFetched || 0);
        const detailsFetchedLabel = detailsFetchedCount > 0 ? String(detailsFetchedCount) : 'Not Scraped';
        const interactionsSnapshotLabel = interactionSamples > 0 ? String(interactionSamples) : 'Not Scraped';
        const followerGrowthTrendAvailable = followerGrowthTrend.available === true;
        const mediaRateLimited = enrichmentDiagnostics.rateLimited === true;
        const reusedCachedEnrichment = enrichmentDiagnostics.reusedCachedEnrichment === true;
        const cachedEvidenceAgeLabel = Number.isFinite(Number(enrichmentDiagnostics.cacheAgeMs))
            ? `${Math.round(Number(enrichmentDiagnostics.cacheAgeMs) / 60000)} min ago`
            : 'unknown age';
        const isPreliminaryAssessment = mediaRateLimited || severeDataMissing || reusedCachedEnrichment;
        const assessmentStageLabel = isPreliminaryAssessment ? 'Preliminary' : 'Final';
        const missingWarnings = [];
        if (!hasTimestampEvidence) missingWarnings.push('No timestamps scraped');
        if (interactionSamples === 0) missingWarnings.push('No engagement/interaction samples');
        if ((enrichmentDiagnostics.detailsFetched || 0) === 0) missingWarnings.push('Media details missing');
        if (mediaRateLimited) missingWarnings.push('Media detail fetch rate-limited by Instagram (HTTP 429)');
        if (reusedCachedEnrichment) missingWarnings.push(`Using cached media enrichment (${cachedEvidenceAgeLabel})`);
        if (!hasBioSignal((data.bio || '').trim().length)) missingWarnings.push('Bio not scraped');
        if (data.hasProfilePic !== true) missingWarnings.push('Profile picture unclear/missing');
        if (postScrapeMismatch) missingWarnings.push('Post count mismatch (posts exist but media could not be fetched)');
        if (!followerGrowthTrendAvailable) missingWarnings.push('Follower growth unavailable');
        if (behavioralUnavailable) missingWarnings.push('Behavioral evidence unavailable');
        const missingWarningsMarkup = missingWarnings.length > 0
            ? missingWarnings.map((item) => `- ${item}`).join('<br>')
            : '- No major evidence gaps';
        const nextSteps = [];
        if (!hasTimestampEvidence) nextSteps.push('Fetch recent post timestamps to compute activity continuity');
        if (interactionSamples === 0) nextSteps.push('Collect like/comment counts to compute engagement rate');
        if ((enrichmentDiagnostics.detailsFetched || 0) === 0) nextSteps.push('Load media details (captions/hashtags) to improve signal quality');
        if (mediaRateLimited) nextSteps.push('Run analysis again when convenient; cache fallback is already applied while rate-limit cooldown clears.');
        if (reusedCachedEnrichment) nextSteps.push('Keep this profile open and rerun later to replace cached enrichment with fresh evidence.');
        if (!hasBioSignal((data.bio || '').trim().length)) nextSteps.push('Scrape profile bio/description to strengthen identity evidence');
        if (postScrapeMismatch) nextSteps.push('Resolve post count mismatch by re-running media URL + detail collection');
        if (!followerGrowthTrendAvailable) nextSteps.push('Track follower growth over multiple snapshots to detect abnormal spikes');
        const nextStepsMarkup = nextSteps.length > 0
            ? nextSteps.slice(0, 3).map((item) => `- ${item}`).join('<br>')
            : '- Current evidence is sufficient for this profile tier';
        const verifiedConfidenceImprovements = [];
        if (data.verified === true) {
            if (!hasTimestampEvidence) {
                verifiedConfidenceImprovements.push('Post timestamps (so continuity/activity becomes "sufficient-data")');
            }
            if (interactionSamples === 0) {
                verifiedConfidenceImprovements.push('Like/comment counts on posts (so engagement metrics fill in)');
            }
            if ((enrichmentDiagnostics.detailsFetched || 0) === 0) {
                verifiedConfidenceImprovements.push('Media detail (captions/hashtags) (so "media details missing" disappears)');
            }
            if (!followerGrowthTrendAvailable) {
                verifiedConfidenceImprovements.push('Follower snapshots over time (so "follower growth unavailable" disappears)');
            }
        }
        const verifiedConfidenceImprovementsMarkup = verifiedConfidenceImprovements.length > 0
            ? verifiedConfidenceImprovements.map((item) => `- ${item}`).join('<br>')
            : '- No extra confidence upgrades needed for this verified profile sample';
        const evidenceSnapshotLabel = `Completeness ${(dataCompleteness * 100).toFixed(0)}% | Details ${detailsFetchedLabel} | Interactions ${interactionsSnapshotLabel} | Media ${mediaItems.length}`;
        const timestampParseAttempts = Number(enrichmentDiagnostics.timestampExtractionAttempts || 0);
        const timestampParseSuccesses = Math.max(
            Number(enrichmentDiagnostics.timestampExtractionSuccesses || 0),
            Number(timestampsSec.length || 0)
        );
        const timestampParseLabel = timestampParseAttempts > 0
            ? `${timestampParseSuccesses}/${timestampParseAttempts}`
            : 'n/a';
        const temporalCoverageLabel = hasTimestampEvidence
            ? `Sufficient (${timestampsSec.length} timestamp samples)`
            : 'Limited (timestamp extraction unavailable in this session)';
        const tier4DisplayLabel = !hasTimestampEvidence
            ? (tier4InteractionSignalsAvailable ? 'partial' : 'unavailable')
            : (tier4InteractionEvidenceAvailable ? 'available' : (tier4PartialEvidenceAvailable ? 'partial' : 'unavailable'));
        const tier4DisplayLabelForReport =
            highTrustEliteProfile && tier4DisplayLabel !== 'available'
                ? `${tier4DisplayLabel} (non-blocking)`
                : tier4DisplayLabel;
        const evidenceTierLabel = `T1 ${tier1ProfileSignalsAvailable ? 'available' : 'unavailable'} | T2 ${tier2NetworkSignalsAvailable ? 'available' : 'unavailable'} | T3 ${tier3MediaEvidenceAvailable ? 'available' : 'unavailable'} | T4 ${tier4DisplayLabelForReport}`;
        const confidenceDrivers = [];
        if (data.verified === true) confidenceDrivers.push('verified badge present');
        if (followerCount >= 1_000_000) confidenceDrivers.push('large established follower base');
        if (Number.isFinite(dataCompleteness)) confidenceDrivers.push(`completeness ${(dataCompleteness * 100).toFixed(0)}%`);
        if ((enrichmentDiagnostics.detailsFetched || 0) === 0) confidenceDrivers.push('no enriched media details');
        if (interactionSamples === 0) confidenceDrivers.push('no interaction samples');
        if (!hasTimestampEvidence && !highTrustEliteProfile) confidenceDrivers.push('timestamps unavailable');
        if (mediaRateLimited) confidenceDrivers.push('Instagram fetch throttling (429)');
        if (reusedCachedEnrichment) confidenceDrivers.push('using cached enrichment evidence');
        if (!tier3MediaEvidenceAvailable) confidenceDrivers.push('tier3 media unavailable');
        if (!tier4InteractionEvidenceAvailable && !highTrustEliteProfile) {
            confidenceDrivers.push(tier4PartialEvidenceAvailable ? 'tier4 interaction partial' : 'tier4 interaction unavailable');
        }
        const confidenceDriversLabel = confidenceDrivers.length > 0 ? confidenceDrivers.slice(0, 4).join(', ') : 'balanced evidence';
        const confidenceUpgradeLabel = (
            data.verified === true &&
            profileConfidence === 'High Confidence' &&
            scrapeCompletenessPct >= 75 &&
            !explicitScamSignals &&
            !explicitImpersonationSignal
        )
            ? '- High confidence already achieved; additional activity analysis is optional.'
            : nextStepsMarkup;
        const profileSummary = (
            data.verified === true &&
            followerCount >= 1_000_000 &&
            postCount >= 500 &&
            !explicitScamSignals &&
            !explicitImpersonationSignal
        )
            ? 'Verified institutional account with massive established audience, long posting history, and consistent profile signals. No impersonation or scam indicators detected.'
            : profileDecision.verdict;
        const tierGateReasons = [];
        if (!tier3MediaEvidenceAvailable) tierGateReasons.push(`t3_needs_media_sample>=${tier3MinMediaSamples}`);
        if (!tier4InteractionEvidenceAvailable) tierGateReasons.push(tier4PartialEvidenceAvailable ? 't4_partial_inline_hints' : `t4_needs_interactions>=${requiredInteractionSamples}`);
        const diagnosticsHintDetails = Number(enrichmentDiagnostics.detailsFetched || 0);
        const diagnosticsHintInteractions = Number(enrichmentDiagnostics.interactionsComputed || 0);
        const diagnosticsDebugLabel = `Debug: hint_details=${diagnosticsHintDetails}, hint_interactions=${diagnosticsHintInteractions}, rate_limited=${mediaRateLimited ? 'yes' : 'no'}, tier_gates=${tierGateReasons.length > 0 ? tierGateReasons.join('|') : 'ok'}`;

        console.log('[Instagram Authentication] Client profile hidden details:', {
            onlineContinuity,
            activitySnapshot: {
                activeDaysLabel,
                inactiveDaysLabel,
                inactivityRatioLabel,
                postingRecencyLabel,
                postsPerDayLabel,
                postingFrequencyLabel,
            },
            engagementSnapshot: {
                engagementRateLabel,
                commentLikeRatioLabel,
                interactionDensityLabel,
                interactionSamplesLabel,
                likeSamplesLabel,
                commentSamplesLabel,
                timestampSamplesLabel,
            },
            warnings: missingWarnings,
            nextSteps,
        });
        analysisSummary.innerHTML = `
            <b>Profile Risk Assessment</b><br>
            Account: <b>${data.username || 'Unknown'}</b><br>
            Assessment Stage: <b>${assessmentStageLabel}</b><br>
            Status: <b>${profileStatus}</b><br>
            Risk Level: <b>${profileRiskLevel}</b><br>
            Confidence: <b>${profileConfidence}</b><br>
            Trust Tier: <b>${trustTier}</b><br>
            Scrape Completeness: <b>${scrapeCompletenessPct}%</b><br>
            Confidence Drivers: <b>${confidenceDriversLabel}</b><br>
            Evidence Tiers: <b>${evidenceTierLabel}</b><br>
            Key Signals: <b>Verified ${data.verified === true ? 'Yes' : 'No'}</b> | <b>Identity ${identityValidity}</b> | <b>Followers ${followerCount.toLocaleString()}</b> | <b>Posts ${postCount.toLocaleString()}</b> | <b>Type ${accountTypeLabel}</b><br>
            Evidence Snapshot: <b>${evidenceSnapshotLabel}</b> | <b>Timestamps ${timestampSamplesLabel}</b> | <b>Timestamp Parse ${timestampParseLabel}</b> | <b>Rate Limited ${mediaRateLimited ? 'Yes' : 'No'}</b><br>
            Temporal Coverage: <b>${temporalCoverageLabel}</b><br>
            Missing Fields: <b>${missingFieldsLabel}</b><br>
            Analysis Time: ${formatDurationMs(effectiveElapsedMs)}<br>
            <small><b>Summary:</b> ${profileSummary}</small><br>
            <small><b>Why this result:</b><br>${profileReasonsMarkup}</small><br>
            <small><b>Missing Fields (Detailed)</b><br>${missingFieldsListMarkup}</small><br>
            <small><b>How To Increase Confidence</b><br>${confidenceUpgradeLabel}</small><br>
            <small>Advanced threat labels require richer behavioral and interaction evidence beyond the current sample.</small><br>
            <small>This assessment is based on public profile signals. Direct messages are not analyzed in this result.</small><br>
        `;
        
        // attach computed risk info to lastProfileData for server
        lastProfileData.heuristics = {
            structuralScore,
            contentScore,
            behavioralScore,
            photoScore,
            weightedTrust,
            finalTrust,
            trustTier,
            preliminaryRisk,
            dataCompleteness,
            confidenceScore,
            behavioralDepth,
            behavioralConfidence,
            tierAvailability,
            postScrapeMismatch,
            severeDataMissing,
            missingFeatures,
            behavioralEvidence,
            interactionSamples,
            enrichedSampleCount,
            avgEngagement,
            medianEngagement,
            engagementStdDev,
            avgLikeRate,
            likeRateStdDev,
            avgCommentRate,
            commentRateStdDev,
            engagementCv,
            likeCv,
            commentCv,
            avgPostingFrequencyDays,
            postingFrequencyStdDev,
            postingIntervalMedianDays,
            postingIntervalIqrDays,
            cadenceStability,
            avgCommentLikeRatio,
            normalizedFollowerFollowingRatio,
            interactionDensity,
            onlineContinuity,
            temporalMetrics: {
                accountAgeDays,
                activeSpanDays,
                activeDays,
                inactiveDays,
                inactivityRatio,
                timestampSamples: timestampsSec.length,
                postsPerDay,
                postsPerActiveDay,
                followerGrowthPerDayProxy,
                postingRecencyDays,
                activityTimeEntropy,
                temporalEstimateUsed,
                hasTimestampEvidence,
                lifecycleInactivityInferable,
            },
            commentUniquenessRatio,
            uniqueCommentUsers,
            totalCommentUsersObserved: commentUsers.length,
            institutionalType,
            identityValidity,
            behavioralNormality,
            validAccountClass: validAccountClass.code,
            validAccountClassLabel: validAccountClass.label,
            validAccountClassDetail: validAccountClass.detail,
            entityBaseline,
            photoSignals,
            governanceEntity,
            institutionalConfidenceScore,
            followerGrowthSnapshots,
            followerGrowthTrend,
            explicitImpersonationSignal,
            weakImpersonationSignal,
            impersonationDetection,
            scienceHits,
            governanceHits,
            internationalHits,
            persuasionHits,
            behavioralUnavailable,
            requiresBehavioralValidation,
            behavioralRequired,
            inactivityRiskSignal,
            sustainedActivitySignal,
            confidenceLimit,
            mediaRateLimited,
            mediaEvidenceAvailable,
            mediaAccessRestricted,
            assessmentStage: assessmentStageLabel,
            isPreliminaryAssessment,
            reusedCachedEnrichment,
            cacheAgeMs: Number(enrichmentDiagnostics.cacheAgeMs || 0),
            observedSignals,
            inferredSignals,
        };
        setPhaseStatus('Client profile analysis complete');

        // --- Phase 5: Permission Gate ---
        requestDeepAnalysis('profile');
    }

    // --- Phase 4: Client-Side Message Analysis ---
    analyseMessageBtn.addEventListener('click', () => {
        beginProgressTimer('Client Message Analysis');
        setPhaseStatus('Scraping messages');
        analysisSummary.textContent = "Performing client-side message analysis...";
        permissionView.style.display = 'none';
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'ANALYZE_MESSAGES' }, function(response) {
                if (chrome.runtime.lastError) {
                    const elapsed = endProgressTimer();
                    analysisSummary.textContent = "Error communicating with content script. Please reload the page.";
                    updateTimerDisplay(`Client Message Analysis failed after ${formatDurationMs(elapsed)}`);
                    setPhaseStatus('Failed');
                    return;
                }
                if (response && response.success) {
                    let elapsed = 0;
                    setPhaseStatus('Computing message heuristics');
                    const uniqueMessages = Array.isArray(response.messages) ? response.messages : [];
                    const rawMessages = Array.isArray(response.rawMessages) && response.rawMessages.length > 0
                        ? response.rawMessages
                        : uniqueMessages;
                    const rawMessageEvents = Array.isArray(response.rawMessageEvents) ? response.rawMessageEvents : [];
                    const incomingEvents = rawMessageEvents.filter((evt) => evt?.senderType === 'incoming');
                    const outgoingEvents = rawMessageEvents.filter((evt) => evt?.senderType === 'outgoing');
                    const unknownSenderEvents = rawMessageEvents.filter((evt) => !evt?.senderType || evt?.senderType === 'unknown');
                    const canUseIncomingOnly = false;
                    const senderScopedMessages = rawMessages;
                    const senderScopedSource = 'mixed-all';
                    lastMessageData = uniqueMessages; // Store for deep analysis
                    lastMessageData.rawMessages = rawMessages;
                    lastMessageData.rawMessageEvents = rawMessageEvents;
                    lastMessageData.conversationName = response.conversationName || null;
                    lastMessageData.scrapeDiagnostics = response.diagnostics || {};
                    refreshFinalPredictionButtonState();

                    // richer message heuristics: lexical, repetition, sequence and URL-risk signals
                    const normalizeMessageTextForDetection = (value) => (
                        String(value || '')
                            .normalize('NFKC')
                            .normalize('NFKD')
                            .replace(/\p{M}+/gu, '')
                            .toLowerCase()
                            .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
                            .replace(/[–—−]/g, '-')
                            .replace(/hxxps?:\/\//g, 'https://')
                            .replace(/\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+/g, '.')
                            .replace(/\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+/g, '@')
                            .replace(/(\d)\s*-\s*(\d)/g, '$1 to $2')
                            .replace(/[^\p{L}\p{N}\s@.+:/_-]/gu, ' ')
                            .replace(/\s+/g, ' ')
                            .trim()
                    );
                    const lowered = senderScopedMessages.map((msg) => String(msg || '').toLowerCase());
                    const normalizedMessagesForDetection = senderScopedMessages.map((msg) => normalizeMessageTextForDetection(msg));
                    const joined = senderScopedMessages.join('\n');
                    const normalizedJoinedForDetection = normalizedMessagesForDetection.join(' ').trim();
                    const keywordDetectionTexts = senderScopedMessages.map((_, idx) => {
                        const raw = lowered[idx] || '';
                        const normalized = normalizedMessagesForDetection[idx] || '';
                        return raw === normalized ? [raw] : [raw, normalized];
                    });
                    const totalMessages = senderScopedMessages.length;
                    const totalObservedMessages = rawMessages.length;
                    if (totalMessages === 0) {
                        elapsed = endProgressTimer();
                        analysisDurations.clientMessageMs = elapsed;
                        lastMessageData.heuristics = {
                            spamScore: 0,
                            urgentScore: 0,
                            burstScore: 0,
                            behavioralScore: 0,
                            overallRisk: 0,
                            messageBlockCount: 0,
                            textLineCount: 0,
                            bulletLineCount: 0,
                            threatScore: 0,
                            repetitionRatio: 0,
                            consecutiveRepeats: 0,
                            shortMessageRatio: 0,
                            avgLength: 0,
                            lengthStdDev: 0,
                            avgWords: 0,
                            emojiPerMessage: 0,
                            linkCount: 0,
                            suspiciousLinkCount: 0,
                            domainCount: 0,
                            unsafeDomainCount: 0,
                            riskyTldCount: 0,
                            riskyKeywordHits: 0,
                            credentialHits: 0,
                            otpKeywordHits: 0,
                            cryptoContextHits: 0,
                            credentialTransferHits: 0,
                            genericCodeRequestHits: 0,
                            platformSwitchHits: 0,
                            redirectionIntentHits: 0,
                            externalRedirectHits: 0,
                            externalHandleHits: 0,
                            safetyNegationHits: 0,
                            reportingContextHits: 0,
                            contextualSafetyShield: 0,
                            recruitmentScamHits: 0,
                            incomeClaimHits: 0,
                            incomeClaimSignalCount: 0,
                            timeBaitHits: 0,
                            mlmGrowthHits: 0,
                            greetingHits: 0,
                            opportunityFramingHits: 0,
                            exclusivityHits: 0,
                            conversationSteeringHits: 0,
                            conversationSteeringLabel: 'None',
                            intentPatternDetected: false,
                            intentPatternScore: 0,
                            intentPatternLabel: 'None',
                            groupBroadcastHits: 0,
                            massOutreachDetected: false,
                            callToActionHits: 0,
                            groupParticipantEstimate: 0,
                            groupCreationSignals: 0,
                            otpCryptoComboDetected: false,
                            impersonationHits: 0,
                            pressureHits: 0,
                            capsRatio: 0,
                            timelineCoverage: 0,
                            avgInterMessageSec: 0,
                            maxBurst2Min: 0,
                            maxBurst5Min: 0,
                            rapidFireRatio: 0,
                            nightActivityRatio: 0,
                            evidenceQuality: 0,
                            riskClass: 'insufficient-data',
                            senderScopedSource: 'mixed',
                            incomingMessageCount: 0,
                            outgoingMessageCount: 0,
                            unknownSenderMessageCount: 0,
                            incomingRatio: 0,
                            outgoingRatio: 0,
                            mediaAttachmentCount: 0,
                            incomingMediaAttachmentCount: 0,
                            mediaOnlyIncomingCount: 0,
                            mediaRiskSignals: 0,
                            conversationRiskSignalCount: 0,
                            conversationRiskBoost: 0,
                            hardRiskRuleApplied: false,
                            confidenceConflict: false,
                            brandTyposquatCount: 0,
                            suspiciousPathHits: 0,
                            trustedConversationSignal: false,
                            scrapeDiagnostics: response.diagnostics || {},
                        };
                        analysisSummary.innerHTML = `
                            <b>Message Risk Assessment</b><br>
                            Status: <b>Limited Evidence</b><br>
                            Risk Level: <b>${getRiskLevelLabel(0)}</b><br>
                            Confidence: <b>Limited Evidence</b><br>
                            Analysis Time: ${formatDurationMs(elapsed)}<br>
                            <small>No message text could be extracted from this chat view. Open the conversation, scroll through message bubbles, then run Analyse Messages again.</small><br>
                            <small>Media attachments were not available for content decoding in this run.</small>
                        `;
                        setPhaseStatus('Client message analysis complete');
                        return;
                    }
                    const uniqueCount = new Set(lowered).size;
                    const repetitionRatio = totalMessages > 0 ? (1 - (uniqueCount / totalMessages)) : 0;
                    let consecutiveRepeats = 0;
                    for (let i = 1; i < lowered.length; i += 1) {
                        if (lowered[i] === lowered[i - 1]) consecutiveRepeats += 1;
                    }
                    const lengths = senderScopedMessages.map((msg) => String(msg || '').trim().length);
                    const avgLength = average(lengths);
                    const lengthStdDev = standardDeviation(lengths);
                    const shortMessageRatio = totalMessages > 0
                        ? (lengths.filter((len) => len > 0 && len < 12).length / totalMessages)
                        : 0;
                    const wordCounts = senderScopedMessages.map((msg) => String(msg || '').trim().split(/\s+/).filter(Boolean).length);
                    const avgWords = average(wordCounts);
                    const emojiMatches = joined.match(/\p{Extended_Pictographic}/gu) || [];
                    const emojiPerMessage = totalMessages > 0 ? (emojiMatches.length / totalMessages) : 0;
                    const links = joined.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
                    const suspiciousLinkMatches = joined.match(/bit\.ly|tinyurl|t\.me|wa\.me|cutt\.ly|rb\.gy|goo\.gl|shorturl|is\.gd/gi) || [];
                    const knownSafeDomains = new Set([
                        'instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com',
                        'whatsapp.com', 'www.whatsapp.com', 'youtube.com', 'www.youtube.com',
                        'google.com', 'www.google.com', 'linkedin.com', 'www.linkedin.com'
                    ]);
                    const riskyTldPattern = /\.(xyz|top|click|work|loan|gq|tk|cf|ml|ga|buzz|rest|cam)\b/i;
                    const extractedDomains = [];
                    for (const rawUrl of links) {
                        let candidate = String(rawUrl || '').trim();
                        if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
                        try {
                            const hostname = new URL(candidate).hostname.toLowerCase();
                            if (hostname) extractedDomains.push(hostname);
                        } catch {
                            // ignore malformed URLs
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
                    const suspiciousPathHits = links.reduce((acc, rawUrl) => (
                        suspiciousPathPattern.test(String(rawUrl || '').toLowerCase()) ? acc + 1 : acc
                    ), 0);
                    const obfuscatedLinkSignals = links.reduce((acc, rawUrl) => {
                        const candidate = String(rawUrl || '').toLowerCase();
                        if (!candidate) return acc;
                        if (candidate.includes('%40') || candidate.includes('@')) acc += 1;
                        if (candidate.includes('login') || candidate.includes('verify') || candidate.includes('secure')) acc += 1;
                        return acc;
                    }, 0);
                    const riskyKeywords = [
                        'urgent', 'act now', 'hurry', 'winner', 'claim', 'lottery', 'crypto', 'investment', 'guaranteed', 'double money',
                        'jaldi', 'turant', 'abhi karo', 'inaam', 'offer khatam', 'link kholo', 'verify karo'
                    ];
                    const credentialKeywords = [
                        'password', 'otp', 'verification code', '2fa', 'login', 'bank account',
                        'pin', 'cvv', 'netbanking', 'ifsc', 'account number', 'aadhaar', 'pan'
                    ];
                    const otpKeywords = ['otp', 'verification code', '2fa', 'one time password', 'security code', 'confirm code'];
                    const cryptoContextKeywords = ['crypto', 'wallet', 'binance', 'exchange', 'usdt', 'bitcoin', 'seed phrase', 'metamask', 'trust wallet', 'coinbase'];
                    const impersonationKeywords = [
                        'instagram support', 'security team', 'official', 'admin', 'help center',
                        'customer care', 'bank support', 'kyc team', 'service desk'
                    ];
                    const credentialTransferKeywords = [
                        'send otp', 'share otp', 'send code', 'share code', 'give otp', 'give code',
                        'confirm code', 'provide code', 'forward otp', 'seed phrase', 'recovery phrase'
                    ];
                    const genericCodeRequestKeywords = [
                        'confirm your code', 'verify your code', 'provide your code', 'submit code', 'account code'
                    ];
                    const platformSwitchKeywords = ['telegram', 't.me', 'whatsapp', 'wa.me', 'signal', 'discord'];
                    const redirectionIntentKeywords = ['continue on', 'message me on', 'chat on', 'dm on', 'switch to', 'move to', 'not secure here', 'apply telegram', 'contact on telegram', 'reach on telegram'];
                    const callToActionKeywords = [
                        'contact us', 'contact me', 'get started', 'apply now', 'message me', 'dm me',
                        'join now', 'reach out', 'start now'
                    ];
                    const safetyNegationKeywords = ['do not share otp', "don't share otp", 'never share otp', 'do not send otp', 'never send otp', 'dont send code', 'do not give code'];
                    const reportingContextKeywords = ['i got a message', 'someone messaged me', 'they asked me', 'he said', 'she said', 'looks strange', 'is this scam', 'is this legit', 'have you seen this'];
                    const recruitmentScamKeywords = [
                        'business partner', 'business partners', 'daily income', 'stable income', 'earn 1000', 'earn 1000+',
                        'part-time', 'part time', '3-5 hours', '3 to 5 hours', 'targets', 'team building',
                        'apply telegram', 'contact us now', 'serious partners', 'upi'
                    ];
                    const incomeClaimKeywords = [
                        'daily income', 'stable daily income', 'stable income', 'earn 1000', 'earn 1000+',
                        'inr daily', 'per day', 'daily payout', 'guaranteed income', 'guaranteed profit'
                    ];
                    const timeBaitKeywords = [
                        '3-5 hours', '3 to 5 hours', 'hours per day', 'only 3', 'part-time', 'part time',
                        'no experience required'
                    ];
                    const mlmGrowthKeywords = [
                        'build and lead a team', 'team building', 'growing team', 'join our growing team',
                        'the more you grow the more you earn', 'targets', 'daily & monthly targets', 'serious partners'
                    ];
                    const pressureKeywords = [
                        'send money', 'wire', 'transfer', 'bitcoin', 'usdt',
                        'immediately pay', 'advance payment', 'processing fee', 'release payment',
                        'pay now', 'hurry', 'urgent', 'final warning', 'last chance'
                    ];
                    const greetingKeywords = ['hi', 'hello', 'hey', 'namaste', 'dear', 'good morning', 'good evening'];
                    const opportunityKeywords = [
                        'expanding', 'partner network', 'partner program', 'new program', 'digital program',
                        'opportunity', 'collaboration', 'invite', 'inviting', 'participate', 'join'
                    ];
                    const exclusivityKeywords = [
                        'selected', 'selecting', 'few users', 'limited participants', 'exclusive', 'early access',
                        'limited slots', 'private program', 'only a few'
                    ];
                    const steeringKeywords = [
                        'let me know', 'reply yes', 'interested', 'would you like details', 'dm me', 'message me',
                        'contact me', 'contact us', 'contact us now', 'reach out', 'reach us', 'get details',
                        'learn more', 'apply through', 'apply via', 'apply on', 'apply telegram', 'apply on telegram',
                        'message us', 'dm us', 'share details', 'send details'
                    ];
                    const broadcastKeywords = [
                        'limited-time opportunity', 'no experience required', 'share the details', 'join us',
                        'running on internet', 'join our team', 'click the link', 'refer and earn'
                    ];
                    const personalizationKeywords = ['bro', 'anna', 'akka', 'ra', 'you', 'your', 'please', 'hey'];

                    const detectionSourceForKeywordHits = `${lowered.join('\n')}\n${normalizedJoinedForDetection}`;
                    const uniqueNormalizedMessages = Array.from(new Set(
                        normalizedMessagesForDetection
                            .map((msg) => String(msg || '').trim())
                            .filter(Boolean)
                    ));
                    const countKeywordHits = (terms) => {
                        const uniqueTerms = Array.from(new Set((terms || []).map((term) => String(term || '').toLowerCase()).filter(Boolean)));
                        return uniqueTerms.reduce((acc, term) => acc + (detectionSourceForKeywordHits.includes(term) ? 1 : 0), 0);
                    };
                    const countPatternHitsByMessage = (regex) => {
                        if (!(regex instanceof RegExp)) return 0;
                        const safeRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
                        let hits = 0;
                        for (const text of uniqueNormalizedMessages) {
                            safeRegex.lastIndex = 0;
                            if (safeRegex.test(text)) hits += 1;
                        }
                        return hits;
                    };
                    const riskyKeywordHits = countKeywordHits(riskyKeywords);
                    const credentialHitsRaw = countKeywordHits(credentialKeywords);
                    const otpKeywordHits = countKeywordHits(otpKeywords);
                    const cryptoContextHits = countKeywordHits(cryptoContextKeywords);
                    const credentialTransferHits = countKeywordHits(credentialTransferKeywords);
                    const genericCodeRequestHits = countKeywordHits(genericCodeRequestKeywords);
                    const platformSwitchHits = countKeywordHits(platformSwitchKeywords);
                    const redirectionIntentHits = countKeywordHits(redirectionIntentKeywords);
                    const safetyNegationHits = countKeywordHits(safetyNegationKeywords);
                    const reportingContextHits = countKeywordHits(reportingContextKeywords);
                    const recruitmentScamHitsByKeyword = countKeywordHits(recruitmentScamKeywords);
                    const recruitmentScamPatternHits = countPatternHitsByMessage(/\b(looking for business partners?|business partners?|stable daily income|earn\s*\d+\+?\s*inr\s*(daily|per day)|only\s*3\s*(to|-)\s*5\s*hours?\s*(per day)?|frequently use upi|apply\s*telegram|contact us now to get started|daily\s*&?\s*monthly targets?)\b/g);
                    const recruitmentScamHits = Math.max(recruitmentScamHitsByKeyword, recruitmentScamPatternHits);
                    const callToActionHitsByKeyword = countKeywordHits(callToActionKeywords);
                    const callToActionPatternHits = countPatternHitsByMessage(/\b(contact us|contact me|get started|apply now|message me|dm me|join now|reach out|start now)\b/g);
                    const callToActionHits = Math.max(callToActionHitsByKeyword, callToActionPatternHits);
                    const credentialRequestHits = countPatternHitsByMessage(/\b(verify|confirm|enter|provide|share|send|submit|login|log in|sign in|reset|update)\b/g);
                    const credentialHits = (credentialHitsRaw > 0 && (credentialRequestHits > 0 || credentialTransferHits > 0 || genericCodeRequestHits > 0))
                        ? credentialHitsRaw
                        : 0;
                    const greetingHits = countKeywordHits(greetingKeywords);
                    const opportunityHits = countKeywordHits(opportunityKeywords);
                    const opportunityPatternHits = countPatternHitsByMessage(/\b(expanding|partner (network|program)|new (digital )?program|opportunity|collaboration|invite(?:d|s|ing)?|participate|join (our|this))\b/g);
                    const opportunityFramingHits = Math.max(opportunityHits, opportunityPatternHits);
                    const exclusivityHitsByKeyword = countKeywordHits(exclusivityKeywords);
                    const exclusivityPatternHits = countPatternHitsByMessage(/\b(selected|selecting|few users|limited participants|exclusive|early access|limited slots|private program|only a few)\b/g);
                    const exclusivityHits = Math.max(exclusivityHitsByKeyword, exclusivityPatternHits);
                    const steeringHitsByKeyword = countKeywordHits(steeringKeywords);
                    const steeringPatternHits = countPatternHitsByMessage(/\b(let me know|reply yes|interested|would you like details|dm (me|us)|message (me|us)|contact (me|us)( now)?|reach (out|us)|learn more|get details|share details|send details|apply (through|via|on)( telegram)?)\b/g);
                    const conversationSteeringHits = Math.max(steeringHitsByKeyword, steeringPatternHits);
                    const incomeClaimHitsByKeyword = countKeywordHits(incomeClaimKeywords);
                    const incomeClaimPatternHits = countPatternHitsByMessage(/\b((earn|make)\s*(up\s*to|upto)?\s*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d+)?\s*[k]?\+?\s*(inr|rs|rupees)?\s*(daily|per day|monthly|per month)?|stable\s*daily\s*income|daily\s*income|daily\s*payout|guaranteed\s*(income|profit))\b/g);
                    const incomeClaimHits = Math.max(incomeClaimHitsByKeyword, incomeClaimPatternHits);
                    const incomeClaimSignals = [
                        /\b(earn|make)\s*(up\s*to|upto)?\s*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d+)?\s*[k]?\+?\s*(inr|rs|rupees)?\b/i.test(normalizedJoinedForDetection),
                        /\bguaranteed\s*(income|profit)\b/i.test(normalizedJoinedForDetection),
                        /\b(daily income|stable income|stable daily income|per day|daily payout)\b/i.test(normalizedJoinedForDetection),
                    ].filter(Boolean).length;
                    const incomeClaimSignalCount = Math.max(incomeClaimSignals, incomeClaimHits > 0 ? 1 : 0);
                    const timeBaitHitsByKeyword = countKeywordHits(timeBaitKeywords);
                    const timeBaitPatternHits = countPatternHitsByMessage(/\b((only|just)?\s*\d+\s*(to|-)\s*\d+\s*hours?\s*(daily|per day)?|(only|just)?\s*\d+\s*hours?\s*(daily|per day)?|part\s*[- ]?time|few\s*hours?\s*(daily|per day))\b/g);
                    const timeBaitHits = Math.max(timeBaitHitsByKeyword, timeBaitPatternHits);
                    const mlmGrowthHitsByKeyword = countKeywordHits(mlmGrowthKeywords);
                    const mlmGrowthPatternHits = countPatternHitsByMessage(/\b((build|lead)\s*a\s*team|join\s*our\s*growing\s*team|the\s*more\s*you\s*grow\s*the\s*more\s*you\s*earn|daily\s*&?\s*monthly\s*targets?)\b/g);
                    const mlmGrowthHits = Math.max(mlmGrowthHitsByKeyword, mlmGrowthPatternHits);
                    const impersonationHits = countKeywordHits(impersonationKeywords);
                    const pressureHitsByKeyword = countKeywordHits(pressureKeywords);
                    const pressurePatternHits = countPatternHitsByMessage(/\b(send\s*money|wire|transfer|advance\s*payment|processing\s*fee|release\s*payment|pay\s*now|hurry|urgent|final\s*warning|last\s*chance)\b/g);
                    const pressureHits = Math.max(pressureHitsByKeyword, pressurePatternHits);
                    const broadcastHits = countKeywordHits(broadcastKeywords);
                    const personalizationHits = countKeywordHits(personalizationKeywords);
                    const diagnostics = response?.diagnostics || {};
                    const parseGroupParticipantEstimateFromText = (value) => {
                        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
                        if (!normalized) return 0;
                        const othersMatch = normalized.match(/\band\s+(\d+)\s+others?\b/i);
                        if (!othersMatch) return 0;
                        const othersCount = Number.parseInt(othersMatch[1], 10);
                        if (!Number.isFinite(othersCount) || othersCount <= 0) return 0;
                        const prefix = normalized.slice(0, othersMatch.index).replace(/[,|]?\s*and\s*$/i, '').trim();
                        const explicitCount = prefix
                            .split(',')
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .length;
                        return (explicitCount > 0 ? explicitCount : 1) + othersCount;
                    };
                    const diagnosticsGroupEstimate = Number(diagnostics.groupParticipantEstimate || 0);
                    const conversationNameEstimate = parseGroupParticipantEstimateFromText(response?.conversationName || '');
                    const groupParticipantEstimate = Math.max(diagnosticsGroupEstimate, conversationNameEstimate);
                    const groupCreationSignals = Number(diagnostics.groupCreationSignals || 0);
                    const groupBroadcastCandidate = diagnostics.groupBroadcastCandidate === true;
                    const groupBroadcastRecruitmentDetected =
                        (
                            (groupBroadcastCandidate || groupParticipantEstimate >= 4 || groupCreationSignals > 0) &&
                            recruitmentScamHits > 0 &&
                            (platformSwitchHits > 0 || incomeClaimHits > 0 || mlmGrowthHits > 0)
                        );
                    const groupBroadcastHits = groupBroadcastRecruitmentDetected ? 1 : 0;
                    const externalRedirectHits = (platformSwitchHits > 0 && redirectionIntentHits > 0) ? 1 : 0;
                    const conversationSteeringLabel = conversationSteeringHits > 0
                        ? ((externalRedirectHits > 0 || callToActionHits > 0) ? 'Detected' : 'Weak')
                        : 'None';
                    const externalHandleHits = (() => {
                        const handles = new Set();
                        for (const msg of uniqueNormalizedMessages) {
                            if (!/(telegram|whatsapp|wa\.me|signal|discord)\b/i.test(msg)) continue;
                            const matches = msg.match(/@[a-z0-9_.]{4,32}/gi) || [];
                            matches.forEach((handle) => handles.add(handle.toLowerCase()));
                        }
                        return handles.size;
                    })();
                    const estimateMessageBlocks = (events, fallbackCount) => {
                        if (!Array.isArray(events) || events.length === 0) return Math.max(1, fallbackCount || 0);
                        let blocks = 0;
                        let lastSender = null;
                        let lastTs = null;
                        for (const evt of events) {
                            const sender = String(evt?.senderType || 'unknown');
                            const ts = Number(evt?.timestampMs);
                            const timeGapOk = (Number.isFinite(ts) && Number.isFinite(lastTs)) ? (ts - lastTs) <= 120000 : true;
                            if (blocks === 0 || sender !== lastSender || !timeGapOk) blocks += 1;
                            lastSender = sender;
                            if (Number.isFinite(ts)) lastTs = ts;
                        }
                        return Math.max(1, blocks);
                    };
                    const messageBlockCount = estimateMessageBlocks(rawMessageEvents, totalMessages);
                    const lineSources = (Array.isArray(uniqueMessages) && uniqueMessages.length > 0)
                        ? uniqueMessages
                        : senderScopedMessages;
                    const { textLineCount, bulletLineCount } = (() => {
                        let textLines = 0;
                        let bulletLines = 0;
                        let textCharCount = 0;
                        const bulletRegex = /^(\d+\.)\s+|^[-*•\u2022]\s+/;
                        const hasAlnum = (value) => /[\p{L}\p{N}]/u.test(value);
                        const noisePattern = /(instagram|dashboard|account created|last login|message requests?|active|seen|typing|search|mute|report|block)/i;
                        for (const msg of lineSources) {
                            const raw = String(msg || '')
                                .replace(/\r\n/g, '\n')
                                .replace(/\r/g, '\n');
                            if (noisePattern.test(raw) && raw.length < 80) continue;
                            const primaryLines = raw.split('\n');
                            const expandedLines = [];
                            primaryLines.forEach((line) => {
                                if (line.includes('•')) {
                                    const parts = line.split('•');
                                    parts.forEach((part, idx) => {
                                        expandedLines.push(idx === 0 ? part : `• ${part}`);
                                    });
                                } else {
                                    expandedLines.push(line);
                                }
                            });
                            for (const line of expandedLines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;
                                if (!hasAlnum(trimmed)) continue;
                                if (bulletRegex.test(trimmed)) {
                                    bulletLines += 1;
                                } else {
                                    textLines += 1;
                                    textCharCount += trimmed.length;
                                }
                            }
                        }
                        const estimatedTextLines = textCharCount > 0 ? Math.ceil(textCharCount / 70) : 0;
                        const adjustedTextLines =
                            bulletLines > 0
                                ? textLines
                                : ((textCharCount > 180 && estimatedTextLines > textLines)
                                    ? Math.max(textLines, Math.min(estimatedTextLines, 20))
                                    : textLines);
                        const messageLineCap = messageBlockCount <= 2 ? 8 : (messageBlockCount <= 5 ? 14 : 24);
                        const cappedTextLines = Math.min(adjustedTextLines, messageLineCap);
                        return { textLineCount: cappedTextLines, bulletLineCount: bulletLines };
                    })();
                    const intentPatternDetected =
                        opportunityFramingHits > 0 &&
                        (exclusivityHits > 0 || conversationSteeringHits > 0 || callToActionHits > 0 || externalRedirectHits > 0);
                    const intentPatternLabel = intentPatternDetected
                        ? ((recruitmentScamHits > 0 || incomeClaimSignalCount > 0 || timeBaitHits > 0 || groupBroadcastRecruitmentDetected)
                            ? 'Recruitment Funnel'
                            : 'Opportunity Pitch')
                        : (opportunityFramingHits > 0 ? 'Opportunity Framing' : 'None');
                    const intentPatternScore =
                        (greetingHits > 0 ? 2 : 0) +
                        (opportunityFramingHits > 0 ? 10 : 0) +
                        (exclusivityHits > 0 ? 12 : 0) +
                        (conversationSteeringHits > 0 ? 8 : 0);
                    const redFlagMessages = senderScopedMessages.filter((msg) => {
                        const text = String(msg || '').toLowerCase();
                        const normalizedText = normalizeMessageTextForDetection(msg);
                        return riskyKeywords.some((k) => text.includes(k) || normalizedText.includes(k)) ||
                            credentialKeywords.some((k) => text.includes(k) || normalizedText.includes(k)) ||
                            impersonationKeywords.some((k) => text.includes(k) || normalizedText.includes(k));
                    });

                    const upperChars = (joined.match(/[A-Z]/g) || []).length;
                    const letterChars = (joined.match(/[A-Za-z]/g) || []).length;
                    const capsRatio = letterChars > 0 ? (upperChars / letterChars) : 0;
                    const scoringTimelineEvents = canUseIncomingOnly ? incomingEvents : rawMessageEvents;
                    const timeline = scoringTimelineEvents
                        .map((evt) => Number(evt?.timestampMs))
                        .filter((n) => Number.isFinite(n))
                        .sort((a, b) => a - b);
                    const interMessageSec = [];
                    for (let i = 1; i < timeline.length; i += 1) {
                        const delta = (timeline[i] - timeline[i - 1]) / 1000;
                        if (delta > 0) interMessageSec.push(delta);
                    }
                    const rapidIntervals = interMessageSec.filter((sec) => sec <= 20).length;
                    const rapidFireRatio = interMessageSec.length > 0 ? (rapidIntervals / interMessageSec.length) : 0;
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
                    const nightMessages = timeline.filter((ms) => {
                        const hour = new Date(ms).getHours();
                        return hour >= 0 && hour < 5;
                    }).length;
                    const nightActivityRatio = timeline.length > 0 ? (nightMessages / timeline.length) : 0;
                    const avgInterMessageSec = average(interMessageSec);
                    const timelineCoverage = totalObservedMessages > 0 ? (timeline.length / totalObservedMessages) : 0;
                    const incomingMessageCount = incomingEvents.length;
                    const outgoingMessageCount = outgoingEvents.length;
                    const unknownSenderMessageCount = unknownSenderEvents.length;
                    const senderKnownTotal = incomingMessageCount + outgoingMessageCount;
                    const incomingRatio = senderKnownTotal > 0 ? (incomingMessageCount / senderKnownTotal) : 0;
                    const outgoingRatio = senderKnownTotal > 0 ? (outgoingMessageCount / senderKnownTotal) : 0;
                    const incomingMediaAttachmentCount = incomingEvents.filter((evt) => evt?.hasMediaAttachment === true).length;
                    const mediaAttachmentCount = rawMessageEvents.filter((evt) => evt?.hasMediaAttachment === true).length;
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
                    for (let i = 1; i < rawMessages.length; i += 1) {
                        const prev = new Set(tokenizeMessage(rawMessages[i - 1]));
                        const curr = new Set(tokenizeMessage(rawMessages[i]));
                        if (prev.size === 0 || curr.size === 0) continue;
                        const intersection = [...curr].filter((token) => prev.has(token)).length;
                        const unionSize = new Set([...prev, ...curr]).size || 1;
                        continuityAccumulator += (intersection / unionSize);
                        continuitySamples += 1;
                    }
                    const conversationContinuity = continuitySamples > 0 ? (continuityAccumulator / continuitySamples) : 0;
                    const evidenceQuality = clampNumber(Math.round(
                        ((totalMessages >= 40) ? 30 : (totalMessages >= 20 ? 22 : (totalMessages >= 8 ? 14 : 8))) +
                        (timelineCoverage * 30) +
                        ((links.length > 0) ? 10 : 0) +
                        ((uniqueDomains.length > 0) ? 10 : 0) +
                        ((repetitionRatio > 0.2) ? 8 : 0) +
                        ((lengthStdDev > 10) ? 6 : 0) +
                        ((avgWords >= 4) ? 6 : 3)
                    ), 0, 100);

                    let burstScore = 0;
                    if (totalMessages >= 45) burstScore += 30;
                    else if (totalMessages >= 30) burstScore += 20;
                    else if (totalMessages >= 20) burstScore += 12;
                    burstScore += Math.min(25, consecutiveRepeats * 3);
                    burstScore += Math.min(20, Math.max(0, maxBurst2Min - 3) * 4);
                    burstScore += Math.min(12, rapidFireRatio * 20);
                    if (nightActivityRatio > 0.5 && timeline.length >= 6) burstScore += 8;
                    burstScore = clampNumber(Math.round(burstScore), 0, 100);

                    const spamScore = clampNumber(Math.round(
                        (repetitionRatio * 55) +
                        (shortMessageRatio * 25) +
                        (Math.min(1, consecutiveRepeats / Math.max(1, totalMessages - 1)) * 20)
                    ), 0, 100);

                    const urgentScore = clampNumber(Math.round(
                        (riskyKeywordHits * 6) +
                        (credentialHits * 10) +
                        (credentialTransferHits * 12) +
                        (genericCodeRequestHits * 8) +
                        (impersonationHits * 8) +
                        (pressureHits * 7) +
                        (recruitmentScamHits * 8) +
                        (incomeClaimHits * 9) +
                        (timeBaitHits * 5) +
                        (mlmGrowthHits * 6) +
                        (groupBroadcastHits * 12) +
                        ((platformSwitchHits > 0 && redirectionIntentHits > 0) ? 10 : 0) +
                        (platformSwitchHits * 3) +
                        (links.length > 0 ? 8 : 0) +
                        (suspiciousLinkMatches.length * 10) +
                        (brandTyposquatCount * 12) +
                        (suspiciousPathHits * 5) +
                        (ipDomainCount * 12) +
                        (punycodeDomainCount * 8) +
                        (obfuscatedLinkSignals * 4) +
                        (unsafeDomainCount * 6) +
                        (riskyTldCount * 9) +
                        (broadcastHits * 4) +
                        (personalizationHits > 0 ? -Math.min(8, personalizationHits * 2) : 0) +
                        (capsRatio > 0.35 ? 8 : 0)
                    ), 0, 100);

                    const complexityPenalty = avgWords > 0 && avgWords < 3 ? 8 : 0;
                    const behavioralScore = clampNumber(Math.round(
                        (spamScore * 0.35) +
                        (urgentScore * 0.45) +
                        (burstScore * 0.2) +
                        complexityPenalty
                    ), 0, 100);
                    const conversationPenalty = conversationContinuity < 0.1 && totalMessages >= 6 ? 8 : 0;
                    const conversationCredit = conversationContinuity >= 0.3 && broadcastHits === 0 ? 6 : 0;
                    const trustedConversationSignal =
                        incomingRatio <= 0.55 &&
                        outgoingRatio >= 0.35 &&
                        conversationContinuity >= 0.3 &&
                        suspiciousLinkMatches.length === 0 &&
                        credentialHits === 0 &&
                        impersonationHits === 0 &&
                        pressureHits === 0;
                    const senderRolePenalty =
                        incomingRatio >= 0.7 && (credentialHits > 0 || suspiciousLinkMatches.length > 0 || pressureHits > 0)
                            ? 8
                            : 0;
                    const outgoingDominanceCredit =
                        outgoingRatio >= 0.7 && incomingRatio <= 0.25 && suspiciousLinkMatches.length === 0
                            ? 8
                            : 0;
                    let mediaRiskSignals =
                        (incomingMediaAttachmentCount > 0 ? 1 : 0) +
                        (mediaOnlyIncomingCount >= 2 ? 1 : 0) +
                        ((incomingMediaAttachmentCount > 0 && (credentialHits > 0 || suspiciousLinkMatches.length > 0 || brandTyposquatCount > 0)) ? 1 : 0);
                    if (mediaAttachmentCount === 0) mediaRiskSignals = 0;
                    const mediaPenalty = mediaRiskSignals >= 2 ? 8 : (mediaRiskSignals === 1 ? 4 : 0);
                    const otpCryptoComboDetected = otpKeywordHits > 0 && cryptoContextHits > 0;
                    const conversationRiskSignalCount = [
                        otpCryptoComboDetected,
                        otpKeywordHits > 0 && (pressureHits > 0 || impersonationHits > 0),
                        credentialHits > 0 && cryptoContextHits > 0,
                    ].filter(Boolean).length;
                    const conversationRiskBoost = conversationRiskSignalCount > 0 ? Math.min(16, conversationRiskSignalCount * 6) : 0;
                    const contextualSafetyShield = clampNumber(
                        ((safetyNegationHits > 0) ? Math.min(18, safetyNegationHits * 10) : 0) +
                        ((reportingContextHits > 0 && credentialTransferHits === 0 && suspiciousLinkMatches.length === 0)
                            ? Math.min(12, reportingContextHits * 6)
                            : 0),
                        0,
                        24,
                    );
                    let overallRisk = clampNumber(Math.round(
                        (urgentScore * 0.5) + (behavioralScore * 0.35) + (spamScore * 0.15)
                    ) + conversationPenalty - conversationCredit + senderRolePenalty + mediaPenalty - outgoingDominanceCredit + conversationRiskBoost - contextualSafetyShield, 0, 100);
                    if (trustedConversationSignal) {
                        overallRisk = clampNumber(overallRisk - 6, 0, 100);
                    }
                    const scamFloorSignals =
                        suspiciousLinkMatches.length +
                        brandTyposquatCount +
                        ipDomainCount +
                        punycodeDomainCount +
                        riskyTldCount +
                        suspiciousPathHits +
                        credentialHits +
                        credentialTransferHits +
                        pressureHits +
                        incomeClaimHits +
                        timeBaitHits +
                        mlmGrowthHits +
                        groupBroadcastHits +
                        ((platformSwitchHits > 0 && redirectionIntentHits > 0) ? 1 : 0) +
                        (riskyKeywordHits >= 2 ? 1 : 0);
                    if (scamFloorSignals >= 3) {
                        const floorRisk = credentialHits > 0 ? 60 : 50;
                        if (overallRisk < floorRisk) {
                            overallRisk = floorRisk;
                        }
                    }
                    let hardRiskRuleApplied = false;
                    if (otpCryptoComboDetected && overallRisk < 60) {
                        overallRisk = 60;
                        hardRiskRuleApplied = true;
                    }
                    if (credentialTransferHits > 0 && (impersonationHits > 0 || pressureHits > 0 || cryptoContextHits > 0) && overallRisk < 70) {
                        overallRisk = 70;
                        hardRiskRuleApplied = true;
                    }
                    if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && pressureHits > 0 && overallRisk < 75) {
                        overallRisk = 75;
                        hardRiskRuleApplied = true;
                    }
                    if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && incomeClaimHits > 0 && overallRisk < 75) {
                        overallRisk = 75;
                        hardRiskRuleApplied = true;
                    }
                    if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && overallRisk < 60) {
                        overallRisk = 60;
                        hardRiskRuleApplied = true;
                    }
                    if (groupBroadcastRecruitmentDetected && recruitmentScamHits >= 2 && platformSwitchHits > 0 && overallRisk < 72) {
                        overallRisk = 72;
                        hardRiskRuleApplied = true;
                    }
                    const riskClass =
                        overallRisk >= 70 ? 'high-risk' :
                        overallRisk >= 40 ? 'suspicious' :
                        'likely-human';

                    console.log('[Instagram Authentication] Message scoring breakdown:', {
                        totalMessages,
                        uniqueMessages: uniqueMessages.length,
                        overallRisk,
                        riskClass,
                        spamScore,
                        urgentScore,
                        burstScore,
                        behavioralScore,
                        repetitionRatio,
                        consecutiveRepeats,
                        shortMessageRatio,
                        avgLength,
                        lengthStdDev,
                        avgWords,
                        emojiPerMessage,
                        links: links.length,
                        suspiciousLinkCount: suspiciousLinkMatches.length,
                        brandTyposquatCount,
                        suspiciousPathHits,
                        domainCount: uniqueDomains.length,
                        unsafeDomainCount,
                        riskyTldCount,
                        ipDomainCount,
                        punycodeDomainCount,
                        obfuscatedLinkSignals,
                        riskyKeywordHits,
                        credentialHits,
                        otpKeywordHits,
                        cryptoContextHits,
                        credentialTransferHits,
                        genericCodeRequestHits,
                        platformSwitchHits,
                        redirectionIntentHits,
                        externalRedirectHits,
                        externalHandleHits,
                        safetyNegationHits,
                        reportingContextHits,
                        contextualSafetyShield,
                        recruitmentScamHitsByKeyword,
                        recruitmentScamPatternHits,
                        recruitmentScamHits,
                        incomeClaimHitsByKeyword,
                        incomeClaimPatternHits,
                        incomeClaimHits,
                        incomeClaimSignalCount,
                        timeBaitHitsByKeyword,
                        timeBaitPatternHits,
                        timeBaitHits,
                        mlmGrowthHitsByKeyword,
                        mlmGrowthPatternHits,
                        mlmGrowthHits,
                        greetingHits,
                        opportunityFramingHits,
                        exclusivityHits,
                        conversationSteeringHits,
                        conversationSteeringLabel,
                        intentPatternDetected,
                        intentPatternScore,
                        callToActionHits,
                        groupParticipantEstimate,
                        groupCreationSignals,
                        groupBroadcastCandidate,
                        groupBroadcastHits,
                        massOutreachDetected: groupBroadcastRecruitmentDetected,
                        pressureHitsByKeyword,
                        pressurePatternHits,
                        otpCryptoComboDetected,
                        impersonationHits,
                        pressureHits,
                        conversationContinuity,
                        timelineCoverage,
                        avgInterMessageSec,
                        maxBurst2Min,
                        maxBurst5Min,
                        rapidFireRatio,
                        nightActivityRatio,
                        senderScopedSource,
                        incomingMessageCount,
                        outgoingMessageCount,
                        unknownSenderMessageCount,
                        incomingRatio,
                        outgoingRatio,
                        mediaAttachmentCount,
                        incomingMediaAttachmentCount,
                        mediaOnlyIncomingCount,
                        trustedConversationSignal,
                        mediaRiskSignals,
                        conversationRiskSignalCount,
                        conversationRiskBoost,
                        hardRiskRuleApplied,
                        evidenceQuality,
                        extractionSamplesRaw: senderScopedMessages.slice(0, 5),
                        extractionSamplesNormalized: normalizedMessagesForDetection.slice(0, 5),
                    });
                    let messageStatus = riskClass === 'high-risk'
                        ? 'Likely Threat'
                        : (riskClass === 'suspicious' ? 'Needs Caution' : 'Likely Safe');
                    if (riskClass === 'likely-human' && (intentPatternDetected || opportunityFramingHits > 0)) {
                        messageStatus = 'Suspicious';
                    }
                    const confidenceConflict =
                        overallRisk < 40 &&
                        (
                            otpCryptoComboDetected ||
                            (credentialHits > 0 && (cryptoContextHits > 0 || pressureHits > 0 || impersonationHits > 0))
                        );
                    const strongSignalCount = [
                        externalRedirectHits > 0,
                        externalHandleHits > 0,
                        recruitmentScamHits > 0,
                        incomeClaimSignalCount > 0,
                        timeBaitHits > 0,
                        mlmGrowthHits > 0,
                        callToActionHits > 0,
                        intentPatternDetected,
                        opportunityFramingHits > 0,
                        exclusivityHits > 0,
                        conversationSteeringHits > 0,
                        groupBroadcastHits > 0,
                        suspiciousLinkMatches.length > 0,
                        credentialHits > 0,
                        pressureHits > 0,
                    ].filter(Boolean).length;
                    const highSignalConfidence =
                        (overallRisk >= 80 && strongSignalCount >= 2) ||
                        (overallRisk >= 70 && strongSignalCount >= 3) ||
                        (overallRisk >= 60 && strongSignalCount >= 4);
                    const messageConfidenceBase = highSignalConfidence
                        ? 'High Confidence'
                        : (evidenceQuality >= 75
                            ? 'High Confidence'
                            : (evidenceQuality >= 50 ? 'Medium Confidence' : 'Limited Evidence'));
                    const messageConfidence = confidenceConflict
                        ? 'Low Confidence (Conflicting Signals)'
                        : messageConfidenceBase;
                    const baseThreatScore = clampNumber(Math.round(
                        (recruitmentScamHits > 0 ? 18 : 0) +
                        (incomeClaimSignalCount > 0 ? 16 : 0) +
                        (timeBaitHits > 0 ? 14 : 0) +
                        (groupBroadcastRecruitmentDetected ? 14 : 0) +
                        (externalRedirectHits > 0 ? 18 : 0) +
                        (callToActionHits > 0 ? 8 : 0) +
                        (externalHandleHits > 0 ? 6 : 0) +
                        (intentPatternDetected ? 10 : 0) +
                        (opportunityFramingHits > 0 ? 8 : 0) +
                        (exclusivityHits > 0 ? 8 : 0) +
                        (conversationSteeringLabel === 'Detected' ? 6 : (conversationSteeringLabel === 'Weak' ? 3 : 0)) +
                        (suspiciousLinkMatches.length > 0 ? 12 : 0) +
                        (credentialHits > 0 ? 14 : 0) +
                        (pressureHits > 0 ? 10 : 0)
                    ), 0, 100);
                    const hardSignals = (
                        suspiciousLinkMatches.length > 0 ||
                        credentialHits > 0 ||
                        credentialTransferHits > 0 ||
                        impersonationHits > 0 ||
                        pressureHits > 0
                    );
                    const maxThreatScore = hardSignals ? 100 : 95;
                    const threatScore = clampNumber(baseThreatScore, 0, maxThreatScore);
                    const calibratedThreatScore = clampNumber(Math.max(threatScore, Math.round(overallRisk)), 0, maxThreatScore);
                    const platformMention = detectionSourceForKeywordHits || '';
                    const telegramMentioned = /\b(telegram|t\.me)\b/i.test(platformMention);
                    const whatsappMentioned = /\b(whatsapp|wa\.me)\b/i.test(platformMention);
                    const discordMentioned = /\bdiscord\b/i.test(platformMention);
                    let threatCategory = 'General Suspicious Activity';
                    let threatSubType = 'n/a';
                    if (recruitmentScamHits > 0 || incomeClaimHits > 0 || timeBaitHits > 0 || intentPatternDetected || (opportunityFramingHits > 0 && conversationSteeringHits > 0)) {
                        threatCategory = 'Recruitment / Task Scam';
                        if (externalRedirectHits > 0) {
                            if (telegramMentioned) threatSubType = 'Telegram Funnel Scam';
                            else if (whatsappMentioned) threatSubType = 'WhatsApp Funnel Scam';
                            else if (discordMentioned) threatSubType = 'Discord Funnel Scam';
                            else threatSubType = 'Platform Redirect Funnel';
                        } else {
                            threatSubType = intentPatternDetected ? 'Early-Stage Recruitment' : 'Recruitment Pitch';
                        }
                    } else if (credentialTransferHits > 0 || credentialHits > 0 || impersonationHits > 0) {
                        threatCategory = 'Credential Harvesting';
                        threatSubType = impersonationHits > 0 ? 'Impersonation Phishing' : 'Credential Request';
                    } else if (cryptoContextHits > 0 && (platformSwitchHits > 0 || credentialHits > 0)) {
                        threatCategory = 'Crypto Phishing';
                        threatSubType = 'Wallet/Exchange Lure';
                    } else if (platformSwitchHits > 0) {
                        threatCategory = 'Platform Redirection Funnel';
                        if (telegramMentioned) threatSubType = 'Telegram Funnel';
                        else if (whatsappMentioned) threatSubType = 'WhatsApp Funnel';
                        else if (discordMentioned) threatSubType = 'Discord Funnel';
                        else threatSubType = 'External Redirect';
                    }
                    let scamStage = 'Initial Contact';
                    if (credentialTransferHits > 0 || pressureHits > 0 || otpCryptoComboDetected) {
                        scamStage = 'Payment / Credential Request';
                    } else if (externalRedirectHits > 0) {
                        scamStage = 'Opportunity Pitch → Platform Redirect';
                    } else if (recruitmentScamHits > 0 || incomeClaimHits > 0 || timeBaitHits > 0 || intentPatternDetected) {
                        scamStage = 'Opportunity Pitch';
                    } else if (groupBroadcastRecruitmentDetected) {
                        scamStage = 'Initial Contact → Outreach';
                    }
                    const messageReasons = [];
                    if (suspiciousLinkMatches.length > 0) messageReasons.push('Suspicious links were detected in message text.');
                    if (credentialHits > 0 || impersonationHits > 0) messageReasons.push('Credential or impersonation language was detected.');
                    if (pressureHits > 0) messageReasons.push('Financial or urgency pressure language was detected.');
                    if (otpCryptoComboDetected) messageReasons.push('OTP/verification and crypto-wallet terms appeared together across the conversation.');
                    if (credentialTransferHits > 0) messageReasons.push('Direct credential-transfer instruction pattern was detected.');
                    if (platformSwitchHits > 0 && redirectionIntentHits > 0) messageReasons.push('Conversation redirection to external platform was detected.');
                    if (recruitmentScamHits > 0) messageReasons.push('Recruitment/income-claim scam language was detected (daily earning or partner pitch pattern).');
                    if (incomeClaimHits > 0) messageReasons.push('Unrealistic daily-income or guaranteed-profit language was detected.');
                    if (timeBaitHits > 0) messageReasons.push('Time-to-income bait language was detected (few hours/day for high return).');
                    if (mlmGrowthHits > 0) messageReasons.push('MLM-style growth/team-building persuasion language was detected.');
                    if (groupBroadcastRecruitmentDetected) messageReasons.push('Group-broadcast recruitment pattern was detected (multi-recipient group context + recruitment pitch).');
                    if (externalHandleHits > 0) messageReasons.push('External contact handle was detected (off-platform contact cue).');
                    if (callToActionHits > 0) messageReasons.push('Call-to-action language was detected (prompting immediate contact).');
                    if (intentPatternDetected) messageReasons.push(`Intent pattern detected (${intentPatternLabel.toLowerCase()}).`);
                    if (opportunityFramingHits > 0 && !intentPatternDetected) messageReasons.push('Opportunity framing language was detected (program/partner expansion cues).');
                    if (exclusivityHits > 0 && !intentPatternDetected) messageReasons.push('Selective recruitment/exclusivity language was detected.');
                    if (conversationSteeringHits > 0 && !intentPatternDetected) {
                        messageReasons.push(
                            conversationSteeringLabel === 'Weak'
                                ? 'Soft conversation steering detected (prompting a response).'
                                : 'Conversation steering language was detected (prompting a response).'
                        );
                    }
                    if (mediaRiskSignals >= 2) messageReasons.push('Incoming media-heavy messages appear with risky context (possible media phishing/lure).');
                    if (trustedConversationSignal) messageReasons.push('Conversation pattern looks relationship-consistent; risk was reduced slightly.');
                    if (contextualSafetyShield > 0) messageReasons.push('Safety/reporting context reduced risk score because message appears cautionary rather than coercive.');
                    if (confidenceConflict) messageReasons.push('Confidence was reduced because high-risk cue combinations conflict with a low computed risk.');
                    if (messageReasons.length === 0) messageReasons.push('No strong phishing/scam patterns were detected in text and links.');
                    const messageReasonsMarkup = messageReasons.slice(0, 4).map((reason) => `- ${reason}`).join('<br>');
                    const scrapeDiagnostics = response.diagnostics || {};
                    const extractionSummary = `raw:${Number(scrapeDiagnostics.rawCount || 0)} unique:${Number(scrapeDiagnostics.uniqueCount || 0)} incoming:${Number(scrapeDiagnostics.incomingCount || 0)} outgoing:${Number(scrapeDiagnostics.outgoingCount || 0)} source:${senderScopedSource}`;
                    const hitSummary = `recruitment:${recruitmentScamHits} (kw:${recruitmentScamHitsByKeyword},pattern:${recruitmentScamPatternHits}) income:${incomeClaimSignalCount} time:${timeBaitHits} mlm:${mlmGrowthHits} pressure:${pressureHits} platform:${platformSwitchHits} redirect:${externalRedirectHits} handles:${externalHandleHits} cta:${callToActionHits} intent:${intentPatternLabel} opp:${opportunityFramingHits} excl:${exclusivityHits} steer:${conversationSteeringHits} groupBroadcast:${groupBroadcastHits} members:${groupParticipantEstimate}`;
                    const extractionSamples = Array.isArray(scrapeDiagnostics.sampleMessages) ? scrapeDiagnostics.sampleMessages : [];
                    const extractionSampleSummary = extractionSamples.length > 0
                        ? extractionSamples.map((sample) => escapeHtml(String(sample || '').slice(0, 80))).join(' | ')
                        : 'none';
                    console.log('[Instagram Authentication] Client message hidden details:', {
                        extractionSummary,
                        hitSummary,
                        extractionSampleSummary,
                        diagnostics: scrapeDiagnostics,
                    });
                    if (!Number.isFinite(elapsed) || elapsed <= 0) {
                        elapsed = endProgressTimer();
                        analysisDurations.clientMessageMs = elapsed;
                    }
                    analysisSummary.innerHTML = `
                        <b>Message Risk Assessment</b><br>
                        Status: <b>${messageStatus}</b><br>
                        Threat Category: <b>${threatCategory}</b><br>
                        Sub-Type: <b>${threatSubType}</b><br>
                        Risk Level: <b>${getRiskLevelLabel(overallRisk)}</b><br>
                        Threat Score: <b>${calibratedThreatScore} / 100</b><br>
                        Confidence: <b>${messageConfidence}</b><br>
                        Indicators: <b>Message Blocks ${messageBlockCount}</b> | <b>Text Lines ${textLineCount}</b> | <b>Bullet Lines ${bulletLineCount}</b> | <b>Links ${links.length}</b> | <b>Suspicious Links ${suspiciousLinkMatches.length}</b> | <b>External Redirects ${externalRedirectHits}</b> | <b>External Handles ${externalHandleHits}</b> | <b>Credential Signals ${credentialHits}</b> | <b>Pressure Signals ${pressureHits}</b><br>
                        Patterns: <b>Income Claim Signals ${incomeClaimSignalCount}</b> | <b>Time-to-Income ${timeBaitHits > 0 ? 'Detected' : 'None'}</b> | <b>Call-to-Action ${callToActionHits > 0 ? 'Detected' : 'None'}</b> | <b>Intent Pattern ${intentPatternLabel}</b> | <b>Opportunity Framing ${opportunityFramingHits > 0 ? 'Detected' : 'None'}</b> | <b>Selective Recruitment ${exclusivityHits > 0 ? 'Detected' : 'None'}</b> | <b>Conversation Steering ${conversationSteeringLabel}</b> | <b>Mass Outreach ${groupBroadcastRecruitmentDetected ? 'Detected' : 'None'}</b> | <b>Group Participants ${groupParticipantEstimate || 0}</b><br>
                        Scam Stage: <b>${scamStage}</b><br>
                        Analysis Time: ${formatDurationMs(elapsed)}<br>
                        <small><b>Why this result:</b><br>${messageReasonsMarkup}</small><br>
                        <small>Media attachments are signal-checked, but image/video content is not semantically decoded.</small>
                    `;
                    setPhaseStatus('Client message analysis complete');
                    
                    lastMessageData.heuristics = {
                        spamScore,
                        urgentScore,
                        burstScore,
                        behavioralScore,
                        overallRisk,
                        messageBlockCount,
                        textLineCount,
                        bulletLineCount,
                        threatScore: calibratedThreatScore,
                        intentPatternLabel,
                        repetitionRatio,
                        consecutiveRepeats,
                        shortMessageRatio,
                        avgLength,
                        lengthStdDev,
                        avgWords,
                        emojiPerMessage,
                        linkCount: links.length,
                        suspiciousLinkCount: suspiciousLinkMatches.length,
                        brandTyposquatCount,
                        suspiciousPathHits,
                        domainCount: uniqueDomains.length,
                        unsafeDomainCount,
                        riskyTldCount,
                        ipDomainCount,
                        punycodeDomainCount,
                        obfuscatedLinkSignals,
                        riskyKeywordHits,
                        credentialHits,
                        otpKeywordHits,
                        cryptoContextHits,
                        credentialTransferHits,
                        genericCodeRequestHits,
                        platformSwitchHits,
                        redirectionIntentHits,
                        externalRedirectHits,
                        externalHandleHits,
                        safetyNegationHits,
                        reportingContextHits,
                        contextualSafetyShield,
                        recruitmentScamHits,
                        incomeClaimHits,
                        incomeClaimSignalCount,
                        timeBaitHits,
                        mlmGrowthHits,
                        callToActionHits,
                        greetingHits,
                        opportunityFramingHits,
                        exclusivityHits,
                        conversationSteeringHits,
                        intentPatternDetected,
                        intentPatternScore,
                        groupBroadcastHits,
                        massOutreachDetected: groupBroadcastRecruitmentDetected,
                        groupParticipantEstimate,
                        groupCreationSignals,
                        otpCryptoComboDetected,
                        impersonationHits,
                        pressureHits,
                        broadcastHits,
                        personalizationHits,
                        conversationContinuity: Number(conversationContinuity.toFixed(3)),
                        capsRatio,
                        timelineCoverage,
                        avgInterMessageSec,
                        maxBurst2Min,
                        maxBurst5Min,
                        rapidFireRatio,
                        nightActivityRatio,
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
                        conversationRiskSignalCount,
                        conversationRiskBoost,
                        hardRiskRuleApplied,
                        confidenceConflict,
                        evidenceQuality,
                        riskClass,
                        scrapeDiagnostics: response.diagnostics || {},
                    };

                    // Route message deep-analysis through the same explicit permission gate.
                    requestDeepAnalysis('message');
                } else {
                    const elapsed = endProgressTimer();
                    analysisSummary.textContent = "Failed to scrape messages.";
                    updateTimerDisplay(`Client Message Analysis failed after ${formatDurationMs(elapsed)}`);
                    setPhaseStatus('Failed');
                }
            });
        });
    });

    // --- Phase 5: Permission Gate Logic ---
    function requestDeepAnalysis(type) {
        permissionView.style.display = 'block';
        if (type === 'profile') {
            permissionMessage.textContent = 'Client profile scan is complete. Start deep profile analysis on the server?';
            deepAnalysisCallback = performDeepProfileAnalysis;
            return;
        }
        if (type === 'message') {
            permissionMessage.textContent = 'Client message scan is complete. Start deep message analysis on the server?';
            deepAnalysisCallback = performDeepMessageAnalysis;
            return;
        }
        permissionMessage.textContent = 'Start deep analysis on the server?';
        deepAnalysisCallback = null;
    }

    confirmDeepAnalysisBtn.addEventListener('click', () => {
        if (typeof deepAnalysisCallback === 'function') {
            deepAnalysisCallback();
        }
        permissionView.style.display = 'none';
        deepAnalysisCallback = null;
    });

    cancelDeepAnalysisBtn.addEventListener('click', () => {
        permissionView.style.display = 'none';
        deepAnalysisCallback = null;
        analysisSummary.textContent = 'Deep analysis cancelled.';
        setPhaseStatus('Awaiting next action');
    });

    // --- Phase 6: Server-Side Deep Profile Analysis ---
    async function performDeepProfileAnalysis() {
        if (!lastProfileData) {
            analysisSummary.textContent = 'No profile data available for deep analysis.';
            return;
        }
        beginProgressTimer('Deep Profile Analysis');
        setPhaseStatus('Validating profile evidence');
        const heuristics = lastProfileData.heuristics || {};
        const followerCount = parseInstagramCount(lastProfileData?.followers);
        const mediaDiagnostics = heuristics?.observedSignals?.mediaCollectionDiagnostics || {};
        const dataCompleteness = Number(heuristics.dataCompleteness || 0);
        const interactionSamples = Number(heuristics.interactionSamples || 0);
        const detailsFetched = Number(mediaDiagnostics.detailsFetched || 0);
        const behavioralUnavailable = heuristics.behavioralUnavailable === true;
        const requiredDeepInteractionSamples = followerCount >= 1_000_000
            ? 10
            : PROFILE_EVIDENCE_POLICY.minInteractionSamples;
        const requiredDeepDetailsFetched = followerCount >= 1_000_000
            ? 10
            : PROFILE_EVIDENCE_POLICY.minDetailsFetched;
        const requiredDeepDataCompleteness = followerCount >= 1_000_000
            ? Math.max(PROFILE_EVIDENCE_POLICY.minDataCompleteness, 0.6)
            : PROFILE_EVIDENCE_POLICY.minDataCompleteness;
        const observedSignals = heuristics?.observedSignals || {};
        const inferredSignals = heuristics?.inferredSignals || {};
        const temporalMetrics = heuristics?.temporalMetrics || observedSignals?.temporalMetrics || {};
        const tierAvailability = heuristics?.tierAvailability || {};
        const mediaSampleSize = Number(observedSignals?.recentMediaCount || 0);
        const timestampsCount = Number(temporalMetrics?.timestampSamples || 0);
        const interactionsComputed = Number(mediaDiagnostics.interactionsComputed || 0);
        const urlsCollected = Number(mediaDiagnostics.urlsCollected || 0);
        const rateLimited = Number(heuristics?.mediaRateLimited === true ? 1 : 0) === 1;
        const evidenceQuality = {
            media_sample_size: mediaSampleSize,
            urls_collected: urlsCollected,
            details_fetched: detailsFetched,
            interactions_computed: interactionsComputed,
            interaction_samples: interactionSamples,
            timestamps_count: timestampsCount,
            rate_limited: rateLimited,
            data_completeness: Number(dataCompleteness.toFixed(2)),
        };
        const tierEvidenceWeights = { t1: 0.3, t2: 0.25, t3: 0.25, t4: 0.2 };
        const tier1Available = tierAvailability.tier1ProfileSignalsAvailable === true;
        const tier2Available = tierAvailability.tier2NetworkSignalsAvailable === true;
        const tier3Available = tierAvailability.tier3MediaEvidenceAvailable === true;
        const tier4TemporalAvailable = timestampsCount > 0;
        const tier4InteractionSignalsAvailable =
            tierAvailability.tier4InteractionSignalsAvailable === true ||
            tierAvailability.tier4InteractionEvidenceAvailable === true ||
            interactionsComputed > 0 ||
            interactionSamples > 0;
        const tier4Available = tier4InteractionSignalsAvailable && tier4TemporalAvailable;
        const tier4PartialAvailable =
            !tier4Available &&
            (
                tierAvailability.tier4PartialEvidenceAvailable === true ||
                tier4InteractionSignalsAvailable ||
                tier4TemporalAvailable
            );
        const tierCoverageScore = clampNumber(
            (tier1Available ? tierEvidenceWeights.t1 : 0) +
            (tier2Available ? tierEvidenceWeights.t2 : 0) +
            (tier3Available ? tierEvidenceWeights.t3 : 0) +
            (tier4Available ? tierEvidenceWeights.t4 : (tier4PartialAvailable ? (tierEvidenceWeights.t4 * 0.5) : 0)),
            0,
            1
        );
        const tierCoverage = {
            t1: tier1Available,
            t2: tier2Available,
            t3: tier3Available,
            t4: tier4Available,
            t4_partial: tier4PartialAvailable,
            coverage_score: Number(tierCoverageScore.toFixed(2)),
        };
        const hardSignals = {
            explicit_scam_signals: inferredSignals.explicitScamSignals === true,
            explicit_impersonation_signal: inferredSignals.explicitImpersonationSignal === true,
            behavioral_anomaly: inferredSignals.behavioralAnomaly === true,
        };
        const reasonCodeSet = new Set(Array.isArray(heuristics?.missingFeatures) ? heuristics.missingFeatures : []);
        if (rateLimited) reasonCodeSet.add('rate_limited_429');
        if (timestampsCount <= 0) reasonCodeSet.add('no_timestamp_evidence');
        if (detailsFetched <= 0) reasonCodeSet.add('no_enriched_media_details');
        if (interactionsComputed <= 0 && interactionSamples <= 0) reasonCodeSet.add('no_interaction_evidence');
        if (mediaSampleSize <= 0) reasonCodeSet.add('no_media_sample');
        const reasonCodes = Array.from(reasonCodeSet);
        const decisionReliability = (
            dataCompleteness >= 0.75 &&
            detailsFetched >= 6 &&
            (interactionSamples >= 6 || interactionsComputed >= 6) &&
            timestampsCount >= 4
        ) ? 'high' : (
            dataCompleteness >= 0.55 &&
            (
                detailsFetched >= 2 ||
                interactionSamples >= 2 ||
                interactionsComputed >= 2 ||
                timestampsCount >= 1
            )
        ) ? 'medium' : 'low';
        const nextFetchPlan = [];
        if (timestampsCount <= 0) nextFetchPlan.push('Fetch recent post timestamps.');
        if (detailsFetched <= 0) nextFetchPlan.push('Fetch media details (captions/hashtags/metrics).');
        if (interactionsComputed <= 0 && interactionSamples <= 0) nextFetchPlan.push('Collect like/comment interaction samples.');
        if (urlsCollected <= 0 || mediaSampleSize <= 0) nextFetchPlan.push('Increase media URL sample coverage.');
        if (nextFetchPlan.length === 0) nextFetchPlan.push('Current evidence quality is sufficient.');
        const reasonCodesLabel = reasonCodes.length > 0 ? reasonCodes.join(', ') : 'none';
        const nextFetchPlanLabel = nextFetchPlan.map((step) => `- ${step}`).join('<br>');
        const evidenceQualityLabel =
            `media=${evidenceQuality.media_sample_size}, urls=${evidenceQuality.urls_collected}, details=${evidenceQuality.details_fetched}, interactions=${evidenceQuality.interactions_computed}, timestamps=${evidenceQuality.timestamps_count}, rate_limited=${evidenceQuality.rate_limited ? 'yes' : 'no'}`;
        const tierCoverageLabel =
            `T1 ${tierCoverage.t1 ? 'yes' : 'no'} | T2 ${tierCoverage.t2 ? 'yes' : 'no'} | T3 ${tierCoverage.t3 ? 'yes' : 'no'} | T4 ${tierCoverage.t4 ? 'yes' : (tierCoverage.t4_partial ? 'partial' : 'no')} | coverage ${Math.round(tierCoverage.coverage_score * 100)}%`;
        const hardSignalsLabel =
            `scam=${hardSignals.explicit_scam_signals ? 'yes' : 'no'}, impersonation=${hardSignals.explicit_impersonation_signal ? 'yes' : 'no'}, behavioral_anomaly=${hardSignals.behavioral_anomaly ? 'yes' : 'no'}`;
        const deepInstitutionalOverrideEligible = isInstitutionalVeryLowRiskProfile(lastProfileData, {
            explicitScamSignals: heuristics?.inferredSignals?.explicitScamSignals === true,
            keywordHits: Number((String(lastProfileData?.bio || '').match(/\b(crypto|investment|guaranteed|loan|recovery|telegram|whatsapp|double money)\b/gi) || []).length),
            suspiciousLinkMatches: Number((String(lastProfileData?.bio || '').match(/bit\.ly|tinyurl|t\.me|linktr\.ee|cutt\.ly|goo\.gl|rb\.gy|wa\.me|telegram/gi) || []).length),
        });
        const gatingReasons = [];
        if (!deepInstitutionalOverrideEligible && dataCompleteness < requiredDeepDataCompleteness) gatingReasons.push(`low_data_completeness(${dataCompleteness.toFixed(2)})`);
        if (!deepInstitutionalOverrideEligible && detailsFetched < requiredDeepDetailsFetched) gatingReasons.push(`insufficient_media_details(${detailsFetched})`);
        if (!deepInstitutionalOverrideEligible && interactionSamples < requiredDeepInteractionSamples) gatingReasons.push(`insufficient_interaction_samples(${interactionSamples})`);
        if (
            !deepInstitutionalOverrideEligible &&
            behavioralUnavailable &&
            interactionSamples < requiredDeepInteractionSamples &&
            detailsFetched < requiredDeepDetailsFetched &&
            dataCompleteness < requiredDeepDataCompleteness
        ) {
            gatingReasons.push('behavioral_unavailable');
        }
        if (gatingReasons.length > 0) {
            const fallbackRisk = Number(heuristics.preliminaryRisk || 50);
            const fallbackConfidence = Math.round(Number(heuristics.confidenceScore || 0) * 100);
            const deepConfidenceGaps = [];
            if (dataCompleteness < requiredDeepDataCompleteness) deepConfidenceGaps.push(`low completeness (${(dataCompleteness * 100).toFixed(0)}%)`);
            if (detailsFetched < requiredDeepDetailsFetched) deepConfidenceGaps.push(`media details ${detailsFetched}/${requiredDeepDetailsFetched}`);
            if (interactionSamples < requiredDeepInteractionSamples) deepConfidenceGaps.push(`interaction samples ${interactionSamples}/${requiredDeepInteractionSamples}`);
            if (behavioralUnavailable) deepConfidenceGaps.push('behavioral evidence unavailable');
            const deepConfidenceDriversLabel = deepConfidenceGaps.length > 0 ? deepConfidenceGaps.join(', ') : 'insufficient deep-evidence coverage';
            const deepNextSteps = [];
            if (detailsFetched < requiredDeepDetailsFetched) deepNextSteps.push('Load additional media details (captions/metrics).');
            if (interactionSamples < requiredDeepInteractionSamples) deepNextSteps.push('Collect more like/comment interaction samples.');
            if (dataCompleteness < requiredDeepDataCompleteness) deepNextSteps.push('Increase profile evidence completeness above threshold.');
            const deepNextStepsMarkup = deepNextSteps.length > 0 ? deepNextSteps.map((step) => `- ${step}`).join('<br>') : '- No additional steps available';
            const elapsed = endProgressTimer();
            analysisDurations.deepProfileMs = elapsed;
            lastDeepProfileResult = {
                riskScore: fallbackRisk,
                riskClassification: 'insufficient-data',
                modelConfidence: fallbackConfidence,
                heuristics: {
                    gatingReasons,
                    dataCompleteness,
                    interactionSamples,
                    detailsFetched,
                    evidence_quality: evidenceQuality,
                    tier_coverage: tierCoverage,
                    hard_signals: hardSignals,
                    decision_reliability: decisionReliability,
                    reason_codes: reasonCodes,
                    next_fetch_plan: nextFetchPlan,
                },
            };
            console.log('[Instagram Authentication] Deep profile fallback (full diagnostics):', lastDeepProfileResult);
            analysisSummary.innerHTML = `
                <b>Deep Profile Analysis Result</b><br>
                Status: <b>Limited Evidence</b><br>
                Risk Level: <b>${getRiskLevelLabel(fallbackRisk)}</b><br>
                Confidence: <b>${getUserConfidenceLabel(fallbackConfidence)}</b><br>
                Confidence Drivers: <b>${deepConfidenceDriversLabel}</b><br>
                Evidence Quality: <b>${evidenceQualityLabel}</b><br>
                Tier Coverage: <b>${tierCoverageLabel}</b><br>
                Hard Signals: <b>${hardSignalsLabel}</b><br>
                Decision Reliability: <b>${decisionReliability}</b><br>
                Reason Codes: <b>${reasonCodesLabel}</b><br>
                Analysis Time: ${formatDurationMs(elapsed)}<br>
                <small>Deep server classification was skipped due to limited evidence.</small><br>
                <small><b>How To Increase Confidence</b><br>${deepNextStepsMarkup}</small><br>
                <small><b>Next Fetch Plan</b><br>${nextFetchPlanLabel}</small><br>
                <small>Do not assign hacker/scam/bot from profile-only output.</small><br>
                <small>This assessment is based on public profile signals only.</small><br>
            `;
            return;
        }
        analysisSummary.textContent = 'Sending data for deep profile analysis...';
        setPhaseStatus('Waiting for deep profile response');
        
        // Feature engineering exactly as the model expects
        const features = {
            "profile pic": lastProfileData.hasProfilePic ? 1 : 0,
            "nums/length username": (lastProfileData.username.replace(/[^0-9]/g, "").length / lastProfileData.username.length) || 0,
            "fullname words": lastProfileData.fullName ? lastProfileData.fullName.split(' ').length : 0,
            "nums/length fullname": lastProfileData.fullName ? (lastProfileData.fullName.replace(/[^0-9]/g, "").length / lastProfileData.fullName.length) : 0,
            "name===username": lastProfileData.username === lastProfileData.fullName ? 1 : 0,
            "description length": lastProfileData.bio ? lastProfileData.bio.length : 0,
            "external URL": lastProfileData.hasExternalUrl ? 1 : 0,
            "private": lastProfileData.private ? 1 : 0,
            "#posts": lastProfileData.postCount || 0,
            "#followers": lastProfileData.followers || 0,
            "#follows": lastProfileData.following || 0
        };

        const bioKeywords = ['crypto','investment','telegram','whatsapp','guaranteed','earn money','link in bio','adult'];
        const detectedKeywords = bioKeywords.filter((k) => (lastProfileData.bio || '').toLowerCase().includes(k));
        const hasContentScore = Number.isFinite(lastProfileData.heuristics?.contentScore);
        const heuristicPayload = {
            preliminaryRiskScore: Number(lastProfileData.heuristics?.preliminaryRisk || 0),
            structuralScore: Number(lastProfileData.heuristics?.structuralScore || 0),
            structuralRisk: clampNumber(100 - Number(lastProfileData.heuristics?.structuralScore || 0), 0, 100),
            contentRisk: hasContentScore
                ? clampNumber(100 - Number(lastProfileData.heuristics?.contentScore || 0), 0, 100)
                : 50,
            behavioralRisk: Number.isFinite(Number(lastProfileData.heuristics?.behavioralScore))
                ? clampNumber(100 - Number(lastProfileData.heuristics?.behavioralScore || 0), 0, 100)
                : 0,
            photoRisk: clampNumber(100 - Number(lastProfileData.heuristics?.photoScore || 0), 0, 100),
            structuralMetrics: {
                engagementRate: Number(lastProfileData.heuristics?.avgEngagement || 0),
            },
            observedSignals: lastProfileData.heuristics?.observedSignals || {},
            inferredSignals: lastProfileData.heuristics?.inferredSignals || {},
            mediaCollectionDiagnostics: lastProfileData.heuristics?.observedSignals?.mediaCollectionDiagnostics || {},
            mediaAccessRestricted: lastProfileData.heuristics?.mediaAccessRestricted === true,
            behavioralUnavailable: lastProfileData.heuristics?.behavioralUnavailable === true,
            requiresBehavioralValidation: lastProfileData.heuristics?.requiresBehavioralValidation === true,
            behavioralRequired: lastProfileData.heuristics?.behavioralRequired === true,
            interactionSamples: Number(lastProfileData.heuristics?.interactionSamples || 0),
            avgEngagement: Number(lastProfileData.heuristics?.avgEngagement || 0),
            avgPostingFrequencyDays: Number.isFinite(Number(lastProfileData.heuristics?.avgPostingFrequencyDays))
                ? Number(lastProfileData.heuristics?.avgPostingFrequencyDays)
                : null,
            postingFrequencyStdDev: Number.isFinite(Number(lastProfileData.heuristics?.postingFrequencyStdDev))
                ? Number(lastProfileData.heuristics?.postingFrequencyStdDev)
                : null,
            avgCommentLikeRatio: Number(lastProfileData.heuristics?.avgCommentLikeRatio || 0),
            commentUniquenessRatio: Number(lastProfileData.heuristics?.commentUniquenessRatio || 0),
            uniqueCommentUsers: Number(lastProfileData.heuristics?.uniqueCommentUsers || 0),
            totalCommentUsersObserved: Number(lastProfileData.heuristics?.totalCommentUsersObserved || 0),
            normalizedFollowerFollowingRatio: Number(lastProfileData.heuristics?.normalizedFollowerFollowingRatio || 0),
            interactionDensity: Number(lastProfileData.heuristics?.interactionDensity || 0),
            temporalMetrics: lastProfileData.heuristics?.temporalMetrics ||
                lastProfileData.heuristics?.observedSignals?.temporalMetrics ||
                {},
            missingFeatures: Array.isArray(lastProfileData.heuristics?.missingFeatures) ? lastProfileData.heuristics.missingFeatures : [],
            bioRisk: { detectedKeywords },
            evidence_quality: evidenceQuality,
            tier_coverage: tierCoverage,
            hard_signals: hardSignals,
            decision_reliability: decisionReliability,
            reason_codes: reasonCodes,
            next_fetch_plan: nextFetchPlan,
        };

        try {
            const createResult = await apiFetchJSON('/api/analyses/client', {
                method: 'POST',
                body: JSON.stringify({
                    contentType: 'profile',
                    content: JSON.stringify(lastProfileData),
                    heuristics: heuristicPayload,
                }),
            });

            const data = await apiFetchJSON(`/api/analyses/${createResult.id}`, { method: 'GET' });
            const profilePrelim = Number(lastProfileData?.heuristics?.preliminaryRisk || 0);
            const deepDecision = deriveDeepProfileDecision(data.riskScore >= 70 ? 1 : 0, profilePrelim);
            lastDeepProfileResult = data;
            console.log('[Instagram Authentication] Deep profile response (full diagnostics):', data);
            const elapsed = endProgressTimer();
            analysisDurations.deepProfileMs = elapsed;
            analysisSummary.innerHTML = `
                <b>Deep Profile Analysis Result</b><br>
                Status: <b>${getUserStatusLabel(mapDecisionLabelToCategory(data.riskClassification || deepDecision.label || ''))}</b><br>
                Risk Level: <b>${getRiskLevelLabel(Number(data.riskScore || 0))}</b><br>
                Confidence: <b>${getUserConfidenceLabel(deepDecision.confidence)}</b><br>
                Evidence Quality: <b>${evidenceQualityLabel}</b><br>
                Tier Coverage: <b>${tierCoverageLabel}</b><br>
                Hard Signals: <b>${hardSignalsLabel}</b><br>
                Decision Reliability: <b>${decisionReliability}</b><br>
                Reason Codes: <b>${reasonCodesLabel}</b><br>
                Analysis Time: ${formatDurationMs(elapsed)}<br>
                <small>${deepDecision.verdict}</small><br>
                <small><b>Next Fetch Plan</b><br>${nextFetchPlanLabel}</small><br>
                <small>Do not assign hacker/scam/bot from profile-only output.</small><br>
                <small>This assessment is based on public profile signals only.</small><br>
            `;
            setPhaseStatus('Deep profile analysis complete');
        } catch (error) {
            console.error('Deep profile analysis error:', error);
            analysisSummary.textContent = `Deep profile analysis failed: ${error.message || error}`;
            const elapsed = endProgressTimer();
            updateTimerDisplay(`Deep Profile Analysis failed after ${formatDurationMs(elapsed)}`);
            setPhaseStatus('Failed');
        }
    }

    // --- Phase 7: Server-Side Deep Message Analysis ---
    async function performDeepMessageAnalysis() {
        if (!lastMessageData || lastMessageData.length === 0) {
            analysisSummary.textContent = 'No messages available for deep analysis.';
            return;
        }
        beginProgressTimer('Deep Message Analysis');
        setPhaseStatus('Preparing message payload');
        analysisSummary.textContent = 'Sending data for deep message analysis...';
        setPhaseStatus('Waiting for deep message response');

        try {
            const rawMessages = Array.isArray(lastMessageData?.rawMessages) && lastMessageData.rawMessages.length > 0
                ? lastMessageData.rawMessages
                : (Array.isArray(lastMessageData) ? lastMessageData : []);
            const rawMessageEvents = Array.isArray(lastMessageData?.rawMessageEvents) ? lastMessageData.rawMessageEvents : [];
            const messagePayload = {
                messages: Array.isArray(lastMessageData) ? lastMessageData : rawMessages,
                rawMessages,
                rawMessageEvents,
                conversationName: lastMessageData?.conversationName || null,
                scrapeDiagnostics: lastMessageData?.scrapeDiagnostics || {},
            };
            const combinedMessageText = JSON.stringify(messagePayload);
            const createResult = await apiFetchJSON('/api/analyses', {
                method: 'POST',
                body: JSON.stringify({ contentType: 'message', content: combinedMessageText }),
            });

            const data = await apiFetchJSON(`/api/analyses/${createResult.id}`, { method: 'GET' });
            lastDeepMessageResult = data;
            console.log('[Instagram Authentication] Deep message response (full diagnostics):', data);
            const elapsed = endProgressTimer();
            analysisDurations.deepMessageMs = elapsed;
            const messageReport = data?.heuristics?.messageReport || {};
            const signalReport = data?.heuristics?.messageCategorySignals || {};
            analysisSummary.innerHTML = `
                <b>Deep Message Analysis Result</b><br>
                Status: <b>${getUserStatusLabel(mapDecisionLabelToCategory(data.riskClassification || 'suspicious-message'))}</b><br>
                Risk Level: <b>${getRiskLevelLabel(Number(data.riskScore || 0))}</b><br>
                Confidence: <b>${getUserConfidenceLabel(Number(data.modelConfidence || 0))}</b><br>
                Classification: <b>${String(data.riskClassification || 'n/a')}</b><br>
                Messages Analyzed: <b>${Number(messageReport.totalMessages || 0)}</b><br>
                Link/Phish Signals: <b>${Number(messageReport.phishingLinkCount || 0)}</b><br>
                Credential Signals: <b>${Number(messageReport.credentialKeywordCount || 0)}</b><br>
                Safety Signals (Self-harm/Threat/Sextortion): <b>${Number(signalReport.selfHarmCount || 0)}/${Number(signalReport.violenceThreatCount || 0)}/${Number(signalReport.blackmailSextortionCount || 0)}</b><br>
                Analysis Time: ${formatDurationMs(elapsed)}<br>
                <small>This assessment is based on text, link/domain patterns, sender-role context, and media-attachment signals.</small><br>
                <small>Image/video pixels are not decoded; only attachment-level indicators are used.</small><br>
            `;
            setPhaseStatus('Deep message analysis complete');
        } catch (error) {
            console.error('Deep message analysis error:', error);
            analysisSummary.textContent = `Deep message analysis failed: ${error.message || error}`;
            const elapsed = endProgressTimer();
            updateTimerDisplay(`Deep Message Analysis failed after ${formatDurationMs(elapsed)}`);
            setPhaseStatus('Failed');
        }
    }
    
    // --- Phase 9: Final Prediction ---
    finalPredictionBtn.addEventListener('click', () => {
        const hasProfile = !!lastProfileData;
        const hasMessages = Array.isArray(lastMessageData) && lastMessageData.length > 0;
        if (!hasProfile && !hasMessages) {
            analysisSummary.textContent = 'Please run "Analyse Profile" or "Analyse Messages" first.';
            return;
        }
        performFinalPrediction({ mode: 'combined' });
    });

    if (finalProfileOnlyBtn) {
        finalProfileOnlyBtn.addEventListener('click', () => {
            if (!lastProfileData) {
                analysisSummary.textContent = 'Please run "Analyse Profile" first.';
                return;
            }
            performFinalPrediction({ mode: 'profileOnly' });
        });
    }

    if (finalMessageOnlyBtn) {
        finalMessageOnlyBtn.addEventListener('click', () => {
            if (!Array.isArray(lastMessageData) || lastMessageData.length === 0) {
                analysisSummary.textContent = 'Please run "Analyse Messages" first.';
                return;
            }
            performFinalPrediction({ mode: 'messageOnly' });
        });
    }

    function performFinalPrediction(options = {}) {
        const mode = options.mode || 'combined';
        const modeLabel = mode === 'profileOnly' ? 'Profile-Only' : (mode === 'messageOnly' ? 'Message-Only' : 'Combined');
        beginProgressTimer(`Final Prediction (${modeLabel})`);
        setPhaseStatus(`Synthesizing final (${modeLabel})`);
        analysisSummary.textContent = `Performing final ${modeLabel.toLowerCase()} analysis...`;
        const startedAt = Date.now();
        const hasProfile = !!lastProfileData;
        const hasMessages = Array.isArray(lastMessageData) && lastMessageData.length > 0;
        const includeProfile = mode !== 'messageOnly' && hasProfile;
        const includeMessages = mode !== 'profileOnly' && hasMessages;
        const hasProfileRiskSignal =
            includeProfile &&
            (
                lastDeepProfileResult?.riskScore !== null &&
                lastDeepProfileResult?.riskScore !== undefined
            ||
                lastProfileData?.heuristics?.preliminaryRisk !== null &&
                lastProfileData?.heuristics?.preliminaryRisk !== undefined
            );
        const hasMessageRiskSignal =
            includeMessages &&
            (
                lastDeepMessageResult?.riskScore !== null &&
                lastDeepMessageResult?.riskScore !== undefined
            ||
                lastMessageData?.heuristics?.overallRisk !== null &&
                lastMessageData?.heuristics?.overallRisk !== undefined
            );
        const accountType = hasProfile
            ? (String(lastProfileData?.accountType || '').toLowerCase().includes('group') ? 'group' : 'solo')
            : 'solo';
        const profileRisk = hasProfileRiskSignal
            ? Number(
                lastDeepProfileResult?.riskScore ??
                lastProfileData?.heuristics?.preliminaryRisk ??
                0
            ) / 100
            : null;
        const messageRisk = hasMessageRiskSignal
            ? Number(
                lastDeepMessageResult?.riskScore ??
                lastMessageData?.heuristics?.overallRisk ??
                0
            ) / 100
            : null;
        let effectiveModeLabel = modeLabel.toUpperCase();
        const useProfileOnlyFallback = mode === 'combined' && includeProfile && !hasMessageRiskSignal;
        const useMessageOnlyFallback = mode === 'combined' && includeMessages && !hasProfileRiskSignal;
        if (useProfileOnlyFallback) effectiveModeLabel = 'PROFILE-ONLY-FALLBACK';
        else if (useMessageOnlyFallback) effectiveModeLabel = 'MESSAGE-ONLY-FALLBACK';
        const finalRisk =
            useProfileOnlyFallback
                ? (profileRisk ?? 0)
                : useMessageOnlyFallback
                    ? (messageRisk ?? 0)
                    : (includeMessages && hasMessageRiskSignal && Number.isFinite(profileRisk)
                        ? (((profileRisk || 0) * 0.3) + ((messageRisk || 0) * 0.7))
                        : (profileRisk ?? 0));

        let finalCategory = 'genuine';
        let finalConfidence = 'Low-Medium';
        let finalReasons = [];

        if (useProfileOnlyFallback && includeProfile) {
            const profileOnlyDecision = deriveProfileOnlyFinalDecision(lastProfileData, profileRisk || 0);
            finalCategory = profileOnlyDecision.category;
            finalConfidence = profileOnlyDecision.confidence;
            finalReasons = [
                'Combined mode fell back to profile-only because message risk is unavailable in this run.',
                ...profileOnlyDecision.reasons,
            ];
        } else if (useMessageOnlyFallback && includeMessages) {
            const deepClass = String(lastDeepMessageResult?.riskClassification || '').toLowerCase();
            const messageRiskClass = String(lastMessageData?.heuristics?.riskClass || '').toLowerCase();
            if (deepClass.includes('hacker')) finalCategory = 'hacker';
            else if (deepClass.includes('scam')) finalCategory = 'scam';
            else if (deepClass.includes('bot')) finalCategory = 'bot';
            else if ((messageRisk || 0) >= 0.7) finalCategory = 'scam';
            else if ((messageRisk || 0) >= 0.4 || messageRiskClass === 'suspicious') finalCategory = 'suspicious';
            else finalCategory = 'genuine';
            finalConfidence =
                Number(lastDeepMessageResult?.modelConfidence || 0) >= 85 ? 'High' :
                Number(lastDeepMessageResult?.modelConfidence || 0) >= 70 ? 'Medium' :
                'Low-Medium';
            finalReasons = [
                'Combined mode fell back to message-only because profile risk is unavailable in this run.',
                `Deep message risk: ${((messageRisk || 0) * 100).toFixed(1)}/100.`,
            ];
        } else if (includeProfile && includeMessages) {
            const finalAccountDecision = deriveFinalAccountLabelAndReasons({
                profileData: lastProfileData,
                messageData: lastMessageData,
                deepProfile: lastDeepProfileResult,
                deepMessage: lastDeepMessageResult,
                finalRisk,
            });
            finalCategory = mapDecisionLabelToCategory(finalAccountDecision.label);
            finalConfidence = finalAccountDecision.confidence || 'Low-Medium';
            finalReasons = Array.isArray(finalAccountDecision.reasons) ? finalAccountDecision.reasons : [];
            if (String(finalAccountDecision.label || '').toLowerCase() === 'insufficient-data') {
                if ((messageRisk || 0) >= 0.55) {
                    finalCategory = 'suspicious';
                    finalConfidence = 'Low-Medium';
                    finalReasons.unshift('Message risk remains elevated; final output stays non-genuine despite incomplete cross-signal evidence.');
                } else {
                    const profileOnlyDecision = deriveProfileOnlyFinalDecision(lastProfileData, profileRisk || 0);
                    finalCategory = profileOnlyDecision.category;
                    finalConfidence = profileOnlyDecision.confidence;
                    finalReasons = profileOnlyDecision.reasons;
                }
            }
        } else if (includeProfile) {
            const profileOnlyDecision = deriveProfileOnlyFinalDecision(lastProfileData, profileRisk || 0);
            finalCategory = profileOnlyDecision.category;
            finalConfidence = profileOnlyDecision.confidence;
            finalReasons = profileOnlyDecision.reasons;
        } else if (includeMessages) {
            const deepClass = String(lastDeepMessageResult?.riskClassification || '').toLowerCase();
            const messageRiskClass = String(lastMessageData?.heuristics?.riskClass || '').toLowerCase();
            if (deepClass.includes('hacker')) finalCategory = 'hacker';
            else if (deepClass.includes('scam')) finalCategory = 'scam';
            else if (deepClass.includes('bot')) finalCategory = 'bot';
            else if ((messageRisk || 0) >= 0.7) finalCategory = 'scam';
            else if ((messageRisk || 0) >= 0.4 || messageRiskClass === 'suspicious') finalCategory = 'suspicious';
            else finalCategory = 'genuine';

            finalConfidence =
                Number(lastDeepMessageResult?.modelConfidence || 0) >= 85 ? 'High' :
                Number(lastDeepMessageResult?.modelConfidence || 0) >= 70 ? 'Medium' :
                'Low-Medium';
            finalReasons = [
                `Message-only prediction used because profile analysis is unavailable on this run.`,
                `Deep message risk: ${((messageRisk || 0) * 100).toFixed(1)}/100.`,
                `Client message risk class: ${messageRiskClass || 'n/a'}.`,
                `Media attachments are signal-checked, but image/video pixels are not decoded.`,
            ];
            if (Number(lastMessageData?.heuristics?.suspiciousLinkCount || 0) > 0) {
                finalReasons.push(`Suspicious links detected: ${lastMessageData.heuristics.suspiciousLinkCount}.`);
            }
            if (Number(lastMessageData?.heuristics?.credentialHits || 0) > 0) {
                finalReasons.push(`Credential-request signals detected: ${lastMessageData.heuristics.credentialHits}.`);
            }
        }

        // Calibration floor: high deep-message risk + concrete phishing/scam cues cannot end as "genuine".
        if (includeMessages) {
            const deepMessageRiskPct = Number(((messageRisk || 0) * 100).toFixed(1));
            const suspiciousLinkCount = Number(lastMessageData?.heuristics?.suspiciousLinkCount || 0);
            const credentialHits = Number(lastMessageData?.heuristics?.credentialHits || 0);
            const pressureHits = Number(lastMessageData?.heuristics?.pressureHits || 0);
            const impersonationHits = Number(lastMessageData?.heuristics?.impersonationHits || 0);
            const phishingLikeSignalStrength = suspiciousLinkCount + credentialHits + pressureHits + impersonationHits;
            const strongSignalCount = [
                credentialHits > 0,
                pressureHits > 0,
                impersonationHits > 0,
            ].filter(Boolean).length;

            if (
                deepMessageRiskPct >= 65 &&
                suspiciousLinkCount > 0 &&
                strongSignalCount >= 2 &&
                (finalCategory === 'genuine' || finalCategory === 'insufficient-data' || finalCategory === 'suspicious')
            ) {
                finalCategory = credentialHits > 0 || impersonationHits > 0 ? 'hacker' : 'scam';
                if (finalConfidence === 'Low-Medium' || finalConfidence === 'Low') finalConfidence = 'Medium';
                finalReasons.unshift(
                    `Calibration override applied: deep message risk ${deepMessageRiskPct}/100 with strong phishing/scam evidence (${strongSignalCount} strong signals, total signal strength ${phishingLikeSignalStrength}).`
                );
            }
        }

        const userReasons = [];
        if (includeProfile && lastProfileData?.verified === true) userReasons.push('Verified account indicator present.');
        if (includeProfile && getSafeProfileCount(lastProfileData?.followers) >= 1_000_000) userReasons.push('Large established follower base detected.');
        if (includeMessages && Number(lastMessageData?.heuristics?.suspiciousLinkCount || 0) > 0) userReasons.push('Suspicious links were detected in message content.');
        if (includeMessages && Number(lastMessageData?.heuristics?.credentialHits || 0) > 0) userReasons.push('Credential/phishing language was detected in message content.');
        if (finalCategory === 'genuine' || finalCategory === 'likely-human') userReasons.push('No strong scam/bot/hacker indicators were detected.');
        if (userReasons.length === 0) userReasons.push('Assessment is based on the available profile/message evidence.');
        const reasonsMarkup = userReasons.slice(0, 3).map((reason) => `- ${reason}`).join('<br>');
        const elapsed = Date.now() - startedAt;
        endProgressTimer();
        if (mode === 'profileOnly') analysisDurations.finalProfileOnlyMs = elapsed;
        else if (mode === 'messageOnly') analysisDurations.finalMessageOnlyMs = elapsed;
        else analysisDurations.finalCombinedMs = elapsed;
        const finalRiskScore = Math.round((finalRisk || 0) * 100);
        const finalLegitimacyScore = clampNumber(100 - finalRiskScore, 0, 100);
        console.log('[Instagram Authentication] Final prediction (full diagnostics):', {
            mode,
            effectiveModeLabel,
            finalCategory,
            finalConfidence,
            finalRiskRaw: finalRisk,
            finalRiskScore,
            finalLegitimacyScore,
            profileRisk,
            messageRisk,
            includeProfile,
            includeMessages,
            finalReasons,
            profileData: lastProfileData,
            messageHeuristics: lastMessageData?.heuristics,
            deepProfile: lastDeepProfileResult,
            deepMessage: lastDeepMessageResult,
        });
        const userStatus = getUserStatusLabel(finalCategory);
        const userRiskLevel = getRiskLevelLabel(finalRiskScore);
        const userConfidence = getUserConfidenceLabel(finalConfidence);
        const profileRiskPct = includeProfile ? Math.round((profileRisk || 0) * 100) : null;
        const profileLegitimacyPct = includeProfile ? clampNumber(100 - profileRiskPct, 0, 100) : null;
        const messageRiskPct = includeMessages ? Math.round((messageRisk || 0) * 100) : null;
        const messageLegitimacyPct = includeMessages ? clampNumber(100 - messageRiskPct, 0, 100) : null;
        const deepProfileClass = String(lastDeepProfileResult?.riskClassification || 'n/a');
        const deepMessageClass = String(lastDeepMessageResult?.riskClassification || 'n/a');
        const summaryText =
            finalCategory === 'genuine'
                ? 'This appears to be a legitimate account based on available signals.'
                : finalCategory === 'insufficient-data'
                    ? 'The system needs more evidence before issuing a strong classification.'
                    : 'Potential risk indicators were detected from the available evidence.';
        analysisSummary.innerHTML = `
            <b>Account Risk Assessment</b><br>
            Status: <b>${userStatus}</b><br>
            Risk Level: <b>${userRiskLevel}</b><br>
            Confidence: <b>${userConfidence}</b><br>
            Key Factors: <b>Risk Score ${finalRiskScore}/100</b> | <b>Legitimacy ${finalLegitimacyScore}/100</b>${includeProfile ? ` | <b>Profile Risk ${profileRiskPct}/100</b> | <b>Profile Legitimacy ${profileLegitimacyPct}/100</b>` : ''}${includeMessages ? ` | <b>Message Risk ${messageRiskPct}/100</b> | <b>Message Legitimacy ${messageLegitimacyPct}/100</b>` : ''} | <b>Deep Profile ${deepProfileClass}</b> | <b>Deep Message ${deepMessageClass}</b><br>
            Analysis Time: ${formatDurationMs(elapsed)}<br>
            <small><b>Summary:</b> ${summaryText}</small><br>
            <small>Mode: ${effectiveModeLabel}</small><br>
            <small><b>Reasons:</b><br>${reasonsMarkup || '- No additional reasons available.'}</small><br>
            ${mode === 'profileOnly' || useProfileOnlyFallback
                ? '<small>This assessment is based on public profile signals. Direct messages are not analyzed in this result.</small><br>'
                : '<small>Media attachments are signal-checked, but image/video content is not semantically decoded.</small><br>'}
        `;
        setPhaseStatus(`Final ${modeLabel.toLowerCase()} complete`);
    }

    // --- Utility Functions ---
    const openUrlInNewTab = (url) => chrome.tabs.create({ url });
    const tryUrls = (urls) => {
        const url = urls.shift();
        if (!url) return;
        fetch(url).then(res => res.ok ? openUrlInNewTab(url) : tryUrls(urls)).catch(() => tryUrls(urls));
    };

    loginBtn.addEventListener('click', () => openUrlInNewTab('http://localhost:3001/login'));
    openDashboardBtn.addEventListener('click', () => openUrlInNewTab('http://localhost:3001/user/dashboard'));
    logoutBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['user', 'token'], () => {
            lastProfileData = null;
            lastMessageData = null;
            lastDeepProfileResult = null;
            lastDeepMessageResult = null;
            Object.keys(analysisDurations).forEach((key) => {
                analysisDurations[key] = null;
            });
            resetTimerDisplay();
            refreshFinalPredictionButtonState();
            authView.style.display = 'block';
            mainView.style.display = 'none';
        });
    });

    // Initializer
    checkAuthAndPageStatus();
});
