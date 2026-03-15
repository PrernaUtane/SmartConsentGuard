/**
 * popup.js — SmartConsent Guard (Fully Self-Contained)
 *
 * Does everything inside the popup itself:
 *  1. Gets active tab URL
 *  2. Calls /check-url directly → shows phishing score immediately
 *  3. Injects script into active tab to extract T&C text
 *  4. Calls /analyze-policy directly → shows full clause analysis
 *
 * Zero dependency on background.js, content.js, or chrome.storage.
 */

"use strict";

const BACKEND = "http://localhost:8000";

const CLAUSE_ICONS = {
  "Data Selling":                "💰",
  "Behavioral Tracking":         "👁",
  "Location Tracking":           "📍",
  "Auto-Renewing Subscriptions": "🔄",
  "Arbitration Clause":          "⚖️",
  "Liability Waiver":            "🛡",
  "Broad Data Sharing":          "🔗",
};

// ─── Entry Point ────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Wire up buttons (no inline onclick allowed by Chrome extension CSP)
  document.getElementById("btn-allow")?.addEventListener("click", allowSite);
  document.getElementById("btn-block")?.addEventListener("click", blockSite);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab || !tab.url || !tab.url.startsWith("http")) {
      done(() => showMessage("🔍", "No HTTP Page", "Navigate to a website to analyze it."));
      return;
    }

    // Show URL
    try {
      document.getElementById("site-url").textContent = new URL(tab.url).hostname;
    } catch {
      document.getElementById("site-url").textContent = tab.url;
    }

    run(tab);
  });
});

// ─── Main Flow ──────────────────────────────────────────────────────────────

async function run(tab) {
  // ── Step 1: Phishing check ──────────────────────────────
  let phishing;
  try {
    const res = await fetch(`${BACKEND}/check-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url }),
      signal: AbortSignal.timeout(8000),
    });
    phishing = await res.json();
  } catch (e) {
    done(() => {
      showMessage("🔌", "Backend Offline",
        "Start start_server.bat then reload this popup.");
      document.getElementById("backend-offline").style.display = "flex";
    });
    return;
  }

  // Show phishing result immediately
  done(() => renderPhishing(phishing));

  // ── Step 2: Extract page text via scripting.executeScript ──
  let pageText = "";
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPolicyText,   // runs inside the page
    });
    pageText = result?.result || "";
  } catch (e) {
    // scripting not allowed on this page (e.g., chrome:// pages), skip
    return;
  }

  if (pageText.length < 150) return;  // no T&C text found

  // Show "analyzing T&C" bar
  showWaitBar("Analyzing Terms & Conditions…");

  // ── Step 3: Analyze T&C text ────────────────────────────
  try {
    const res = await fetch(`${BACKEND}/analyze-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pageText }),
      signal: AbortSignal.timeout(90000),   // NLP model can be slow
    });
    const analysis = await res.json();
    removeWaitBar();
    renderAnalysis(analysis);
  } catch (e) {
    removeWaitBar();
    // Phishing result is still visible, T&C just won't update
  }
}

// ─── Page Text Extractor (runs inside the page via executeScript) ────────────
// IMPORTANT: this function must be self-contained (no outer scope references).

function extractPolicyText() {
  const HEADING_RE = [
    /terms\s*(of\s*(service|use))?/i,
    /privacy\s*polic/i,
    /cookie\s*polic/i,
    /user\s*agreement/i,
    /legal\s*(notice|terms)/i,
    /data\s*(processing|protection|use)/i,
  ];

  const SELECTORS = [
    "[id*='terms']", "[id*='privacy']", "[id*='policy']",
    "[id*='legal']", "[id*='tos']", "[id*='agreement']",
    "[class*='terms']", "[class*='privacy']", "[class*='policy']",
    "[class*='legal']", "[class*='tos']",
    "article", "main", "[role='main']",
    ".content", ".page-content", "#content",
  ];

  const KEYWORDS = [
    "personal data", "personal information", "third parties",
    "we may", "we collect", "privacy", "terms",
    "liability", "governing law", "arbitration",
    "your data", "cookies", "opt-out",
  ];

  function looksLegal(text, relaxed) {
    if (!text || text.length < 150) return false;
    const lower = text.toLowerCase();
    const hits = KEYWORDS.filter(k => lower.includes(k)).length;
    return relaxed ? hits >= 1 : hits >= 2;
  }

  function clean(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 5000);
  }

  // 1. Dedicated sections
  for (const sel of SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || el.textContent || "").trim();
        if (looksLegal(text, false)) return clean(text);
      }
    } catch (_) {}
  }

  // 2. Headings
  for (const h of document.querySelectorAll("h1,h2,h3,h4")) {
    if (HEADING_RE.some(re => re.test(h.innerText || ""))) {
      let out = "", sib = h.nextElementSibling;
      while (sib && out.length < 4000) {
        out += " " + (sib.innerText || "");
        sib = sib.nextElementSibling;
      }
      if (out.trim().length > 150) return clean(out);
    }
  }

  // 3. Whole-page fallback for policy URLs
  const url = location.href.toLowerCase();
  if (/privacy|terms|tos|legal|policy|cookies|agreement/.test(url)) {
    const body = document.body.innerText || "";
    if (looksLegal(body, true)) return clean(body.slice(0, 5000));
  }

  return "";
}

// ─── Render Phishing Result ──────────────────────────────────────────────────

function renderPhishing(phishing) {
  const score = phishing.risk_score ?? 0;
  const level = score > 60 ? "HIGH" : score > 30 ? "MEDIUM" : "LOW";

  setBanner(level);
  setBadge(level);
  animateRing(score, level);
  document.getElementById("score-label").textContent = "URL Risk Score / 100";

  if (phishing.reasons?.length > 0) {
    showExplanation("⚠ URL Risk Signals:\n• " + phishing.reasons.join("\n• "));
  }
}

// ─── Render Full T&C Analysis ────────────────────────────────────────────────

function renderAnalysis(analysis) {
  const score = analysis.risk_score ?? 0;
  const level = analysis.level ?? "LOW";

  setBanner(level);
  setBadge(level);
  animateRing(score, level);
  document.getElementById("score-label").textContent = "T&C Risk Score / 100";

  if (analysis.clauses?.length > 0) renderClauses(analysis.clauses);
  if (analysis.explanation)        showExplanation(analysis.explanation);
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function done(fn) {
  document.getElementById("loading-state").style.display = "none";
  document.getElementById("main-content").style.display = "block";
  fn();
}

function setBanner(level) {
  const map = {
    HIGH:   ["danger",    "🔴 HIGH RISK DETECTED"],
    MEDIUM: ["analyzing", "🟡 MEDIUM RISK DETECTED"],
    LOW:    ["safe",      "🟢 LOW RISK — Site appears safe"],
  };
  const [cls, text] = map[level] ?? ["scanning", "Analyzing…"];
  document.getElementById("status-banner").className = `status-banner ${cls}`;
  document.getElementById("status-text").textContent = text;
}

function setBadge(level) {
  const badge = document.getElementById("risk-level-badge");
  badge.textContent = `${level} RISK`;
  badge.className = `risk-level-badge ${level.toLowerCase()}`;
}

function showExplanation(text) {
  document.getElementById("explanation-section").style.display = "block";
  document.getElementById("explanation-text").textContent = text;
}

function showMessage(icon, title, body) {
  const el = document.getElementById("no-policy-state");
  el.style.display = "block";
  el.innerHTML = `
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-text">${body}</div>
  `;
  animateRing(0, "LOW");
  setBadge("LOW");
  setBanner("LOW");
}

function showWaitBar(msg) {
  if (document.getElementById("wait-bar")) return;
  const el = document.createElement("div");
  el.id = "wait-bar";
  el.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 18px;" +
    "font-size:11px;color:#ffa502;background:rgba(255,165,2,0.08);" +
    "border-bottom:1px solid rgba(255,165,2,0.15)";
  el.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></div><span>${msg}</span>`;
  document.getElementById("status-banner").insertAdjacentElement("afterend", el);
}

function removeWaitBar() {
  document.getElementById("wait-bar")?.remove();
}

// ─── SVG Ring Animation ──────────────────────────────────────────────────────

function animateRing(score, level) {
  const CIRC = 188.5;
  const fill = document.getElementById("score-ring-fill");
  const num  = document.getElementById("score-number");

  // SVG elements don't support className as a setter — use setAttribute
  fill.setAttribute("class", `score-ring-fill ${level.toLowerCase()}`);

  setTimeout(() => {
    fill.style.strokeDashoffset = CIRC - (score / 100) * CIRC;
  }, 80);

  num.textContent = score;
  if (score === 0) return;

  let cur = 0;
  const step = Math.ceil(score / 30);
  const iv = setInterval(() => {
    cur = Math.min(cur + step, score);
    num.textContent = cur;
    if (cur >= score) clearInterval(iv);
  }, 30);
}

// ─── Clause List ─────────────────────────────────────────────────────────────

function renderClauses(clauses) {
  document.getElementById("clauses-section").style.display = "block";
  const list = document.getElementById("clauses-list");
  list.innerHTML = "";
  clauses.forEach((c, i) => {
    const pct  = Math.round((c.confidence ?? 0) * 100);
    const icon = CLAUSE_ICONS[c.type] ?? "⚠";
    const item = document.createElement("div");
    item.className = "clause-item";
    item.innerHTML = `
      <div class="clause-icon">${icon}</div>
      <div class="clause-info">
        <div class="clause-name">${c.type}</div>
        <div class="clause-bar-container">
          <div class="clause-bar-fill" style="width:0%"></div>
        </div>
      </div>
      <div class="clause-confidence">${pct}%</div>`;
    list.appendChild(item);
    setTimeout(() => {
      item.querySelector(".clause-bar-fill").style.width = `${pct}%`;
    }, 100 + i * 60);
  });
}

// ─── Action Buttons ──────────────────────────────────────────────────────────

function allowSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) { window.close(); return; }
    let hostname;
    try { hostname = new URL(tab.url).hostname; } catch { return; }

    chrome.storage.local.get("allowed_sites", (storage) => {
      const allowed_sites = new Set(storage.allowed_sites || []);
      allowed_sites.add(hostname);
      chrome.storage.local.set({ allowed_sites: [...allowed_sites] }, () => {
        window.close();
      });
    });
  });
}

function blockSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) { window.close(); return; }
    let hostname;
    try { hostname = new URL(tab.url).hostname; } catch { return; }

    chrome.storage.local.get("blocked_sites", (storage) => {
      const blocked_sites = new Set(storage.blocked_sites || []);
      blocked_sites.add(hostname);
      chrome.storage.local.set({ blocked_sites: [...blocked_sites] }, () => {
        chrome.tabs.remove(tab.id); // instantly close tab
      });
    });
  });
}
