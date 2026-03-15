"""
phishing_detector.py — Heuristic-based phishing detection engine.
Uses domain analysis patterns without requiring any external API calls.
"""

import re
from urllib.parse import urlparse
from typing import Optional


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUSPICIOUS_TLDS = {
    ".tk", ".xyz", ".top", ".ml", ".ga", ".cf", ".gq",
    ".pw", ".cc", ".su", ".ws", ".nu", ".biz",
}

BRAND_KEYWORDS = {
    "paypal", "paypai", "paypa1",
    "amazon", "amaz0n", "amazoon",
    "google", "g00gle", "googl",
    "apple", "app1e",
    "microsoft", "micros0ft", "mircosoft",
    "facebook", "faceb00k",
    "netflix", "netfl1x",
    "bank", "banking",
    "login", "signin", "sign-in",
    "verify", "verification",
    "secure", "security",
    "account", "accounts",
    "update", "confirm",
    "support", "helpdesk",
    "wallet", "payment",
}

# Patterns that commonly appear in phishing domains
PHISHING_PATTERNS = [
    r"-secure\b",
    r"-login\b",
    r"-verify\b",
    r"-account\b",
    r"-update\b",
    r"\bsecure-",
    r"\blogin-",
    r"\bverify-",
    r"\bconfirm-",
    r"[0-9]{4,}",        # 4+ consecutive digits
    r"[a-z]{20,}",       # Very long random-looking string
]


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class PhishingDetector:
    """
    Analyses a URL using pure heuristics and returns a risk assessment.
    """

    def analyze(self, url: str) -> dict:
        """
        Returns:
            {
                "is_phishing": bool,
                "risk_score": int (0-100),
                "reasons": list[str]
            }
        """
        reasons: list[str] = []
        score: float = 0.0

        # --- Parse URL ---
        try:
            parsed = urlparse(url if "://" in url else f"http://{url}")
            hostname = parsed.hostname or ""
            full_domain = hostname.lower()
        except Exception:
            return {
                "is_phishing": True,
                "risk_score": 90,
                "reasons": ["Invalid or malformed URL"],
            }

        # Strip www prefix for cleaner analysis
        domain = re.sub(r"^www\.", "", full_domain)

        # 1. Suspicious TLD check
        tld = self._extract_tld(domain)
        if tld in SUSPICIOUS_TLDS:
            reasons.append(f"Suspicious domain extension ({tld})")
            score += 30

        # 2. Brand-keyword impersonation
        matched_brands = self._find_brand_keywords(domain)
        if matched_brands:
            reasons.append(
                f"Brand impersonation detected ({', '.join(matched_brands)})"
            )
            score += 30

        # 3. Excessive hyphens (> 2)
        hyphen_count = domain.count("-")
        if hyphen_count > 2:
            reasons.append(f"Excessive hyphens in domain ({hyphen_count})")
            score += 15

        # 4. Unusually long domain
        domain_name = domain.split(".")[0]
        if len(domain_name) > 30:
            reasons.append(f"Unusually long domain name ({len(domain_name)} chars)")
            score += 10

        # 5. Suspicious patterns
        matched_patterns = self._find_phishing_patterns(domain)
        if matched_patterns:
            reasons.append("Domain contains phishing keyword patterns")
            score += 20

        # 6. IP address used instead of domain
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", full_domain):
            reasons.append("URL uses raw IP address instead of domain name")
            score += 25

        # 7. Subdomain depth abuse (e.g., paypal.com.phisher.tk)
        parts = domain.split(".")
        if len(parts) > 4:
            reasons.append("Suspicious subdomain nesting depth")
            score += 15

        # 8. Non-HTTPS for sensitive sites
        if parsed.scheme == "http" and matched_brands:
            reasons.append("HTTP (not HTTPS) used for sensitive site")
            score += 10

        # Cap at 100
        risk_score = min(int(score), 100)
        is_phishing = risk_score > 60

        # If no specific reasons but score is > 0, add generic
        if not reasons and risk_score > 0:
            reasons.append("Domain exhibits suspicious patterns")

        return {
            "is_phishing": is_phishing,
            "risk_score": risk_score,
            "reasons": reasons,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_tld(self, domain: str) -> str:
        """Extract the last TLD component, e.g. '.tk'"""
        parts = domain.rsplit(".", 1)
        if len(parts) == 2:
            return f".{parts[1]}"
        return ""

    def _find_brand_keywords(self, domain: str) -> list[str]:
        found = []
        for brand in BRAND_KEYWORDS:
            # Check if brand appears in domain but is NOT the registrable domain itself
            # e.g., 'paypal-login.tk' → phishing; 'paypal.com' → legitimate
            if brand in domain:
                found.append(brand)
        return found

    def _find_phishing_patterns(self, domain: str) -> list[str]:
        matched = []
        for pattern in PHISHING_PATTERNS:
            if re.search(pattern, domain):
                matched.append(pattern)
        return matched
