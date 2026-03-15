"""
risk_engine.py — Weighted risk score aggregator and explanation generator.

Combines privacy, legal, and security risk sub-scores into a single
final score with a human-readable explanation.
"""

from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# Risk weights
# ---------------------------------------------------------------------------

PRIVACY_WEIGHT = 0.50   # Most impactful for user
LEGAL_WEIGHT   = 0.30   # Important but less immediate
SECURITY_WEIGHT = 0.20  # General security posture

# Clause → (privacy_risk, legal_risk) contribution (0–100)
CLAUSE_RISK_MAP = {
    "Data Selling":                 {"privacy": 95, "legal": 60, "security": 40},
    "Behavioral Tracking":          {"privacy": 85, "legal": 40, "security": 50},
    "Location Tracking":            {"privacy": 90, "legal": 50, "security": 60},
    "Auto-Renewing Subscriptions":  {"privacy": 20, "legal": 80, "security": 10},
    "Arbitration Clause":           {"privacy": 10, "legal": 95, "security": 10},
    "Liability Waiver":             {"privacy": 15, "legal": 90, "security": 20},
    "Broad Data Sharing":           {"privacy": 80, "legal": 55, "security": 45},
}

# Explanation templates per detected clause
CLAUSE_EXPLANATIONS = {
    "Data Selling":
        "Your personal data may be sold to third parties without explicit consent.",
    "Behavioral Tracking":
        "Your browsing activity may be tracked for advertising or profiling purposes.",
    "Location Tracking":
        "Your physical location may be collected and stored by this service.",
    "Auto-Renewing Subscriptions":
        "Subscriptions may auto-renew and charge your account without clear warning.",
    "Arbitration Clause":
        "You may be required to waive your right to sue in court.",
    "Liability Waiver":
        "The company limits its responsibility for harm caused to you.",
    "Broad Data Sharing":
        "Your data may be shared with a wide range of partners or affiliates.",
}

RISK_LEVELS = [
    (30, "LOW"),
    (60, "MEDIUM"),
    (100, "HIGH"),
]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ClauseResult:
    type: str
    confidence: float          # 0.0 – 1.0

@dataclass
class RiskReport:
    risk_score: int            # 0 – 100
    level: str                 # LOW / MEDIUM / HIGH
    clauses: list[ClauseResult]
    explanation: str


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class RiskEngine:
    """
    Computes a final risk score from detected clauses and explains the risk
    in plain language.
    """

    def compute(self, clauses: list[ClauseResult]) -> RiskReport:
        if not clauses:
            return RiskReport(
                risk_score=0,
                level="LOW",
                clauses=[],
                explanation="No significant privacy or legal risks were detected.",
            )

        # Accumulate weighted sub-scores per clause (weighted by confidence)
        privacy_scores = []
        legal_scores   = []
        security_scores = []

        for clause in clauses:
            mapping = CLAUSE_RISK_MAP.get(clause.type, {
                "privacy": 50,
                "legal": 50,
                "security": 30,
            })
            weight = clause.confidence  # confidence acts as the clause weight
            privacy_scores.append(mapping["privacy"] * weight)
            legal_scores.append(mapping["legal"] * weight)
            security_scores.append(mapping["security"] * weight)

        # Average sub-scores (cap at 100)
        privacy  = min(sum(privacy_scores)  / max(len(privacy_scores), 1), 100)
        legal    = min(sum(legal_scores)    / max(len(legal_scores), 1), 100)
        security = min(sum(security_scores) / max(len(security_scores), 1), 100)

        # Weighted final score
        final = (
            privacy  * PRIVACY_WEIGHT +
            legal    * LEGAL_WEIGHT   +
            security * SECURITY_WEIGHT
        )
        risk_score = min(int(round(final)), 100)
        level = self._level(risk_score)
        explanation = self._explain(clauses, level)

        return RiskReport(
            risk_score=risk_score,
            level=level,
            clauses=clauses,
            explanation=explanation,
        )

    # ------------------------------------------------------------------

    @staticmethod
    def _level(score: int) -> str:
        for threshold, label in RISK_LEVELS:
            if score <= threshold:
                return label
        return "HIGH"

    @staticmethod
    def _explain(clauses: list[ClauseResult], level: str) -> str:
        if not clauses:
            return "No significant risks detected."

        parts = []
        for c in clauses:
            exp = CLAUSE_EXPLANATIONS.get(c.type)
            if exp:
                parts.append(exp)

        if not parts:
            return f"This service has a {level} risk level based on its terms."

        base = " ".join(parts)
        prefix = {
            "LOW":    "Minor concerns found. ",
            "MEDIUM": "Moderate privacy and legal concerns detected. ",
            "HIGH":   "Significant risks detected. ",
        }.get(level, "")

        return prefix + base
