document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(window.location.search);
  const rawUrl   = params.get("url")     || "";
  const score    = parseFloat(params.get("score") || "0");
  const tabId    = parseInt(params.get("tabId") || "0", 10);
  let   reasons  = [];

  try {
    reasons = JSON.parse(decodeURIComponent(params.get("reasons") || "[]"));
  } catch (_) {
    reasons = ["Suspicious domain patterns detected"];
  }

  // ─── Populate URL ───────────────────────────────────
  let displayUrl = rawUrl;
  try { displayUrl = new URL(rawUrl).hostname; } catch {}
  document.getElementById("warning-url").textContent = displayUrl || rawUrl;

  // ─── Score badge ────────────────────────────────────
  document.getElementById("warning-score").textContent = score;
  const badge = document.getElementById("score-badge");
  if (score > 60) {
    badge.style.background = "rgba(255,71,87,0.15)";
    badge.style.borderColor = "rgba(255,71,87,0.5)";
    badge.style.color = "#ff4757";
  } else if (score > 30) {
    badge.style.background = "rgba(255,165,2,0.15)";
    badge.style.borderColor = "rgba(255,165,2,0.5)";
    badge.style.color = "#ffa502";
  }

  // ─── Reasons list ───────────────────────────────────
  const list = document.getElementById("reasons-list");
  list.innerHTML = "";
  const reasonsToShow = reasons.length > 0
    ? reasons
    : ["Domain exhibits suspicious patterns"];

  reasonsToShow.forEach((r, i) => {
    const item = document.createElement("div");
    item.className = "reason-item";
    item.style.animationDelay = `${i * 80}ms`;
    item.innerHTML = `
      <span class="reason-bullet">•</span>
      <span>${escapeHtml(r)}</span>
    `;
    list.appendChild(item);
  });

  // ─── Actions ────────────────────────────────────────

  document.getElementById("btn-go-back").addEventListener("click", function () {
    if (chrome.tabs && tabId) {
      chrome.tabs.goBack(tabId).catch(() => {
        // Fallback if no history or error
        chrome.tabs.remove(tabId).catch(() => window.close());
      });
    } else {
      window.close();
    }
  });

  document.getElementById("btn-proceed").addEventListener("click", function () {
    // Retrieve the stored original URL
    chrome.storage.session.get([`blockedUrl_${tabId}`], (data) => {
      const targetUrl = data[`blockedUrl_${tabId}`] || rawUrl;
      
      // Tell background.js to allowlist this URL
      chrome.runtime.sendMessage(
        { type: "ALLOW_TAB", url: targetUrl },
        () => {
          if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
          // Navigate to the original URL
          window.location.href = targetUrl;
        }
      );
    });
  });

  // ─── Helper ─────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
});
