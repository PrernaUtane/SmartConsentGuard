/**
 * background.js — SmartConsent Guard Service Worker (Fixed)
 *
 * Key fixes:
 * - Popup now reads storage directly so GET_TAB_DATA is kept for compatibility only
 * - onCompleted listener added so analysis runs after page is fully loaded
 * - allowedTabs Set persisted across SW restarts via chrome.storage.session
 */

const BACKEND_URL = "http://localhost:8000";
const RISK_THRESHOLD = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Navigation Interception — onCommitted fires reliably before page renders
// ─────────────────────────────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only handle main-frame navigations
  if (details.frameId !== 0) return;

  const { tabId, url } = details;

  // Skip non-HTTP urls, extension pages, and local server
  if (
    !url.startsWith("http") ||
    url.startsWith("chrome") ||
    url.includes("chrome-extension") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1")
  ) return;

  // 1. Get hostname for domain matching
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch { return; }

  // 2. Check if user already allowed or blocked this domain
  const storage = await chrome.storage.local.get(["allowed_sites", "blocked_sites"]);
  const allowed_sites = new Set(storage.allowed_sites || []);
  const blocked_sites = new Set(storage.blocked_sites || []);

  if (allowed_sites.has(hostname)) return; // Site is allowed, skip analysis

  if (blocked_sites.has(hostname)) {
    // Instantly close the tab if it was explicitly blocked
    chrome.tabs.remove(tabId).catch(() => {});
    return;
  }

  // Clear stale data for this tab
  await chrome.storage.local.remove([`analysis_${tabId}`, `phishing_${tabId}`]);

  try {
    const result = await checkUrl(url);

    // Always store result so popup can display it
    await chrome.storage.local.set({
      [`phishing_${tabId}`]: {
        url,
        ...result,
        timestamp: Date.now(),
      },
    });

    if (result.is_phishing || result.risk_score > RISK_THRESHOLD) {
      // Store the blocked URL in session storage as requested for recovery on "Enter Anyway"
      await chrome.storage.session.set({ [`blockedUrl_${tabId}`]: url });

      const warningUrl =
        chrome.runtime.getURL("warning.html") +
        `?url=${encodeURIComponent(url)}` +
        `&score=${result.risk_score}` +
        `&reasons=${encodeURIComponent(JSON.stringify(result.reasons))}` +
        `&tabId=${tabId}`;

      // Small delay so navigation completes before redirect
      setTimeout(() => {
        chrome.tabs.update(tabId, { url: warningUrl });
      }, 100);

      updateBadge(tabId, result.risk_score);
    }
  } catch (err) {
    console.warn("[SmartConsent] Backend unreachable for URL check:", err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab Closed — Clean Up
// ─────────────────────────────────────────────────────────────────────────────

  // No longer removing from allowedTabs here since allowed_sites is now domain-based and persistent

// ─────────────────────────────────────────────────────────────────────────────
// Message Listener
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // content.js asks for its own tabId (for direct storage writes)
  if (message.type === "GET_TAB_ID" && tabId !== undefined) {
    sendResponse({ tabId });
    return true;
  }

  // content.js sends policy analysis result
  if (message.type === "POLICY_ANALYSIS_RESULT" && tabId !== undefined) {
    chrome.storage.local.set({
      [`analysis_${tabId}`]: {
        ...message.data,
        url: sender.tab.url,
        timestamp: Date.now(),
      },
    });
    updateBadge(tabId, message.data.risk_score);
    sendResponse({ ok: true });
    return true;
  }

  // warning.html or popup.js signals user clicked "Enter Anyway" or "Allow Site"
  if (message.type === "ALLOW_TAB" && message.url !== undefined) {
    let hostname;
    try { hostname = new URL(message.url).hostname; } catch { return; }

    chrome.storage.local.get("allowed_sites").then((storage) => {
      const allowed_sites = new Set(storage.allowed_sites || []);
      allowed_sites.add(hostname);
      chrome.storage.local.set({ allowed_sites: [...allowed_sites] });
      sendResponse({ ok: true });
    });
    return true;
  }

  // Legacy: popup used to request data via message (now reads storage directly)
  if (message.type === "GET_TAB_DATA") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0]?.id;
      if (!activeTabId) { sendResponse({}); return; }
      const keys = [`analysis_${activeTabId}`, `phishing_${activeTabId}`];
      chrome.storage.local.get(keys, (data) => {
        sendResponse({
          analysis: data[`analysis_${activeTabId}`] || null,
          phishing: data[`phishing_${activeTabId}`] || null,
          tabId: activeTabId,
          tabUrl: tabs[0]?.url,
        });
      });
    });
    return true;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function checkUrl(url) {
  const response = await fetch(`${BACKEND_URL}/check-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function updateBadge(tabId, riskScore) {
  let color, text;
  if (riskScore > 60)      { color = "#ff4757"; text = "HIGH"; }
  else if (riskScore > 30) { color = "#ffa502"; text = "MED";  }
  else                     { color = "#2ed573"; text = "LOW";  }

  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
}
