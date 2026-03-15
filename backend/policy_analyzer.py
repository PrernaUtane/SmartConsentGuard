"""
policy_analyzer.py — NLP-based Terms & Conditions risk analyzer.

Uses the HuggingFace `transformers` zero-shot classification pipeline
with the cross-encoder/nli-distilroberta-base model to detect risky
legal clauses in privacy policies and terms of service text.
"""

import re
import logging
from typing import Optional
from functools import lru_cache

try:
    from transformers import pipeline
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False
    logging.warning("transformers not installed – NLP analysis will be unavailable.")

from risk_engine import RiskEngine, ClauseResult


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NLP_MODEL = "cross-encoder/nli-distilroberta-base"

CANDIDATE_LABELS = [
    "Data Selling",
    "Behavioral Tracking",
    "Location Tracking",
    "Auto-Renewing Subscriptions",
    "Arbitration Clause",
    "Liability Waiver",
    "Broad Data Sharing",
]

# Minimum confidence to include a clause in results
CONFIDENCE_THRESHOLD = 0.55

# Max characters per chunk sent to the model
CHUNK_SIZE = 500

# Hypothesis template for zero-shot NLI
HYPOTHESIS_TEMPLATE = "This text contains a {} clause."


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------

class PolicyAnalyzer:
    """
    Detects risky legal clauses using zero-shot NLI classification.
    Falls back to keyword heuristics if the model is unavailable.
    """

    def __init__(self):
        self._classifier = None
        self._risk_engine = RiskEngine()
        self._load_model()

    def _load_model(self):
        if not HF_AVAILABLE:
            logging.warning("Skipping model load — transformers not installed.")
            return
        try:
            logging.info(f"Loading NLP model: {NLP_MODEL} …")
            self._classifier = pipeline(
                "zero-shot-classification",
                model=NLP_MODEL,
                device=-1,           # CPU
            )
            logging.info("NLP model loaded successfully.")
        except Exception as e:
            logging.error(f"Failed to load NLP model: {e}")
            self._classifier = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, text: str) -> dict:
        """
        Analyze `text` and return a structured risk report dict.
        """
        text = self._preprocess(text)
        if not text:
            return self._empty_result()

        if self._classifier is not None:
            clauses = self._nlp_classify(text)
        else:
            # Fallback: keyword heuristics
            clauses = self._keyword_classify(text)

        report = self._risk_engine.compute(clauses)

        return {
            "risk_score": report.risk_score,
            "level": report.level,
            "clauses": [
                {"type": c.type, "confidence": round(c.confidence, 3)}
                for c in report.clauses
            ],
            "explanation": report.explanation,
        }

    # ------------------------------------------------------------------
    # NLP Classification
    # ------------------------------------------------------------------

    def _nlp_classify(self, text: str) -> list[ClauseResult]:
        """
        Chunk text, run zero-shot classification on each chunk, then
        aggregate results by taking the max confidence per label.
        """
        chunks = self._chunk_text(text, CHUNK_SIZE)
        label_scores: dict[str, float] = {label: 0.0 for label in CANDIDATE_LABELS}

        for chunk in chunks:
            try:
                result = self._classifier(
                    chunk,
                    candidate_labels=CANDIDATE_LABELS,
                    hypothesis_template=HYPOTHESIS_TEMPLATE,
                    multi_label=True,
                )
                for label, score in zip(result["labels"], result["scores"]):
                    if score > label_scores[label]:
                        label_scores[label] = score
            except Exception as e:
                logging.warning(f"Chunk classification failed: {e}")
                continue

        # Build clause list from scores above threshold
        clauses = []
        for label, score in label_scores.items():
            if score >= CONFIDENCE_THRESHOLD:
                clauses.append(ClauseResult(type=label, confidence=score))

        # Sort by confidence descending
        clauses.sort(key=lambda c: c.confidence, reverse=True)
        return clauses

    # ------------------------------------------------------------------
    # Keyword Fallback
    # ------------------------------------------------------------------

    KEYWORD_MAP = {
        "Data Selling": [
            "sell your information", "sell your data", "sell personal",
            "sold to third parties", "share and sell", "monetize your data",
        ],
        "Behavioral Tracking": [
            "track your behavior", "behavioral data", "browsing activity",
            "track your activity", "usage patterns", "analytics tracking",
        ],
        "Location Tracking": [
            "location data", "gps", "geolocation", "precise location",
            "track your location", "your location",
        ],
        "Auto-Renewing Subscriptions": [
            "auto-renew", "automatically renew", "recurring charge",
            "subscription renews", "billed automatically",
        ],
        "Arbitration Clause": [
            "binding arbitration", "arbitration agreement", "waive right to sue",
            "class action waiver", "dispute resolution",
        ],
        "Liability Waiver": [
            "not liable", "no liability", "limitation of liability",
            "disclaim all warranties", "as-is", "without warranty",
        ],
        "Broad Data Sharing": [
            "share with partners", "share with affiliates", "third-party sharing",
            "share information with", "disclose to third",
        ],
    }

    def _keyword_classify(self, text: str) -> list[ClauseResult]:
        text_lower = text.lower()
        clauses = []
        for label, keywords in self.KEYWORD_MAP.items():
            hits = sum(1 for kw in keywords if kw in text_lower)
            if hits > 0:
                # Approximate confidence from keyword hit count
                confidence = min(0.60 + hits * 0.08, 0.95)
                clauses.append(ClauseResult(type=label, confidence=confidence))
        clauses.sort(key=lambda c: c.confidence, reverse=True)
        return clauses

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _preprocess(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000]  # Hard limit

    @staticmethod
    def _chunk_text(text: str, size: int) -> list[str]:
        words = text.split()
        chunks = []
        current: list[str] = []
        count = 0
        for word in words:
            current.append(word)
            count += len(word) + 1
            if count >= size:
                chunks.append(" ".join(current))
                current = []
                count = 0
        if current:
            chunks.append(" ".join(current))
        return chunks or [text]

    @staticmethod
    def _empty_result() -> dict:
        return {
            "risk_score": 0,
            "level": "LOW",
            "clauses": [],
            "explanation": "No text provided for analysis.",
        }
