"""
main.py — SmartConsent Guard FastAPI backend server.

Endpoints:
    GET  /health         → Server health check
    POST /check-url      → Phishing / suspicious URL analysis
    POST /analyze-policy → Terms & Conditions NLP risk analysis
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, field_validator

from phishing_detector import PhishingDetector
from policy_analyzer import PolicyAnalyzer


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("smartconsent")


# ---------------------------------------------------------------------------
# App initialisation (lazy-load heavy models on startup)
# ---------------------------------------------------------------------------

phishing_detector: PhishingDetector | None = None
policy_analyzer:   PolicyAnalyzer   | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global phishing_detector, policy_analyzer
    logger.info("Starting SmartConsent Guard backend …")

    phishing_detector = PhishingDetector()
    logger.info("PhishingDetector ready.")

    policy_analyzer = PolicyAnalyzer()
    logger.info("PolicyAnalyzer ready.")

    yield  # ← server runs here

    logger.info("Shutting down SmartConsent Guard backend.")


app = FastAPI(
    title="SmartConsent Guard API",
    description=(
        "AI-powered browser security backend. "
        "Detects phishing URLs and analyzes Terms & Conditions for risky clauses."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Allow requests from the Chrome extension (chrome-extension://* origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class UrlRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def url_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("url must not be empty")
        return v.strip()


class PolicyRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def text_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("text must not be empty")
        return v.strip()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["system"])
def health_check():
    """Returns server status and loaded component info."""
    return {
        "status": "ok",
        "service": "SmartConsent Guard",
        "version": "1.0.0",
        "components": {
            "phishing_detector": phishing_detector is not None,
            "policy_analyzer":   policy_analyzer   is not None,
            "nlp_model_loaded":  (
                policy_analyzer is not None
                and policy_analyzer._classifier is not None
            ),
        },
    }


@app.post("/check-url", tags=["phishing"])
def check_url(request: UrlRequest):
    """
    Analyse a URL for phishing / suspicious domain patterns.

    Returns:
        is_phishing (bool), risk_score (0–100), reasons (list[str])
    """
    if phishing_detector is None:
        raise HTTPException(status_code=503, detail="Phishing detector not ready.")

    logger.info(f"Checking URL: {request.url}")
    result = phishing_detector.analyze(request.url)
    logger.info(
        f"URL check result — score={result['risk_score']}, "
        f"phishing={result['is_phishing']}"
    )
    return result


@app.post("/analyze-policy", tags=["policy"])
def analyze_policy(request: PolicyRequest):
    """
    Analyze Terms & Conditions / Privacy Policy text for risky clauses.

    Returns:
        risk_score, level, clauses (with confidence), explanation
    """
    if policy_analyzer is None:
        raise HTTPException(status_code=503, detail="Policy analyzer not ready.")

    text_preview = request.text[:80].replace("\n", " ")
    logger.info(f"Analyzing policy text: '{text_preview}…'")

    result = policy_analyzer.analyze(request.text)
    logger.info(
        f"Policy analysis result — score={result['risk_score']}, "
        f"level={result['level']}, clauses={len(result['clauses'])}"
    )
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
