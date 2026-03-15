/**
 * content.js — SmartConsent Guard Content Script
 *
 * Detects T&C / Privacy Policy text and sends it to the backend.
 * Improved: multiple scan attempts with increasing delays,
 * broader text extraction, reliable message delivery.
 */

(function () {
  "use strict";

  const BACKEND_URL = "http://localhost:8000";

  // Prevent duplicate scanning across page lifecycle
  if (window.__scgScanned) return;
  window.__scgScanned = true;

  // Try scanning at 1s, 3s, 6s after page load
  // (SPA frameworks may render content late)
  let attempts = 0;
  const DELAYS = [1000, 3000, 6000];

  function scheduleNext() {
    if (attempts >= DELAYS.length) return;
    setTimeout(tryScan, DELAYS[attempts++]);
  }

  scheduleNext();

  // ─── Main Scan ─────────────────────────────────────────────

  function tryScan() {
    const text = extractPolicyText();

    if (!text || text.length < 150) {
      // Not found yet — try again later
      scheduleNext();
      return;
    }

    // Found policy text — send to backend
    analyzeText(text);
  }

  // ─── Text Extraction ───────────────────────────────────────

  const HEADING_RE = [
    /terms\s*(of\s*(service|use))?/i,
    /privacy\s*polic/i,
    /cookie\s*polic/i,
    /user\s*agreement/i,
    /legal\s*(notice|terms)/i,
    /end[\s-]?user\s*(license|licence)/i,
    /data\s*(processing|protection|use)/i,
  ];

  const SECTION_SELECTORS = [
    "[id*='terms']", "[id*='privacy']", "[id*='policy']",
    "[id*='agreement']", "[id*='legal']", "[id*='tos']",
    "[class*='terms']", "[class*='privacy']", "[class*='policy']",
    "[class*='legal']", "[class*='tos']",
    "article", "main", "[role='main']",
    ".content", ".page-content", "#content",
  ];

  const POLICY_KEYWORDS = [
    "personal data", "personal information", "third parties",
    "we may", "we collect", "privacy", "terms", "liability",
    "governing law", "arbitration", "your data", "cookies",
    "opt-out", "data retention", "intellectual property",
  ];

  function extractPolicyText() {
    // 1. Check if the entire page URL suggests a policy page
    const url = location.href.toLowerCase();
    const isLikelyPolicyPage = /privacy|terms|tos|legal|policy|cookies|agreement/.test(url);

    // 2. Look for dedicated sections by selector
    for (const sel of SECTION_SELECTORS) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.innerText || el.textContent || "").trim();
          if (looksLegal(text, isLikelyPolicyPage)) return clean(text);
        }
      } catch (_) {}
    }

    // 3. Scan headings → grab subsequent sibling content
    const headings = document.querySelectorAll("h1,h2,h3,h4");
    for (const h of headings) {
      if (HEADING_RE.some((re) => re.test(h.innerText || ""))) {
        const text = gatherSiblings(h, 4000);
        if (text.length > 150) return clean(text);
      }
    }

    // 4. Whole-page fallback for dedicated policy pages
    if (isLikelyPolicyPage) {
      const body = document.body.innerText || "";
      if (looksLegal(body, true)) return clean(body.slice(0, 5000));
    }

    return null;
  }

  function looksLegal(text, relaxed = false) {
    if (!text || text.length < 150) return false;
    const lower = text.toLowerCase();
    const hits = POLICY_KEYWORDS.filter((k) => lower.includes(k)).length;
    return relaxed ? hits >= 1 : hits >= 2;
  }

  function gatherSiblings(el, maxChars) {
    let out = "";
    let sib = el.nextElementSibling;
    while (sib && out.length < maxChars) {
      out += " " + (sib.innerText || sib.textContent || "");
      sib = sib.nextElementSibling;
    }
    return out.trim();
  }

  function clean(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 5000);
  }

  // ─── Backend Request ───────────────────────────────────────

  async function analyzeText(text) {
    try {
      const res = await fetch(`${BACKEND_URL}/analyze-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(60000), // model can be slow
      });

      if (!res.ok) {
        console.warn("[SmartConsent] /analyze-policy returned", res.status);
        return;
      }

      const result = await res.json();

      // Store directly in chrome.storage.local so popup can read it
      // (also send message to background as backup)
      const tabId = await getTabId();
      if (tabId) {
        chrome.storage.local.set({
          [`analysis_${tabId}`]: {
            ...result,
            url: location.href,
            timestamp: Date.now(),
          },
        });
      }

      // Also message background.js (in case it's awake)
      chrome.runtime.sendMessage({
        type: "POLICY_ANALYSIS_RESULT",
        data: result,
      }).catch(() => {}); // ignore if SW is asleep

    } catch (err) {
      if (err.name !== "AbortError") {
        console.warn("[SmartConsent] Policy analysis error:", err.message);
      }
    }
  }

  // ─── Get Current Tab ID ────────────────────────────────────

  async function getTabId() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_TAB_ID" });
      return response?.tabId ?? null;
    } catch {
      return null;
    }
  }

})();
