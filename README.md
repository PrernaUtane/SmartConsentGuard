# SmartConsent Guard

> AI-powered Chrome Extension that protects users from phishing websites and risky Terms & Conditions in real time.

---

## 📁 Project Structure

```
SmartConsentGuard/
├── backend/
│   ├── main.py                # FastAPI server (3 API routes)
│   ├── phishing_detector.py   # Heuristic URL risk engine
│   ├── policy_analyzer.py     # NLP zero-shot T&C clause detector
│   ├── risk_engine.py         # Weighted risk aggregator
│   └── requirements.txt
├── extension/
│   ├── manifest.json          # Chrome Manifest V3
│   ├── background.js          # Navigation interceptor (service worker)
│   ├── content.js             # T&C text extractor
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup controller
│   ├── warning.html           # Phishing block page
│   ├── styles.css             # Shared dark-theme CSS
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── start_server.bat           # One-click Windows server launcher
```

---

## ⚙️ Setup Instructions

### Step 1 — Install Python dependencies

```bash
cd d:\Python\SmartConsentGuard\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> 💡 `transformers` will automatically download the NLP model (`cross-encoder/nli-distilroberta-base`, ~250 MB) on first run.

### Step 2 — Start the Backend Server

**Option A: Double-click** `start_server.bat` (auto-creates venv and installs deps)

**Option B: Manual**
```bash
cd d:\Python\SmartConsentGuard\backend
.venv\Scripts\activate
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The server starts at: `http://127.0.0.1:8000`  
API docs: `http://127.0.0.1:8000/docs`

### Step 3 — Load the Chrome Extension

1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the folder: `d:\Python\SmartConsentGuard\extension\`
5. The SmartConsent Guard shield icon appears in your toolbar

---

## 🧪 Testing Commands

### Health Check
```powershell
Invoke-WebRequest -Uri "http://localhost:8000/health" -Method GET | Select-Object -ExpandProperty Content
```

### Phishing URL Test
```powershell
$body = '{"url":"http://paypal-login-secure.tk"}'
Invoke-WebRequest -Uri "http://localhost:8000/check-url" -Method POST -Body $body -ContentType "application/json" | Select-Object -ExpandProperty Content
```

Expected response:
```json
{
  "is_phishing": true,
  "risk_score": 80,
  "reasons": ["Suspicious domain extension (.tk)", "Brand impersonation detected (paypal, login, secure)"]
}
```

### Policy Analysis Test
```powershell
$body = '{"text":"We may sell your personal information to third parties for targeted advertising purposes. Your location data and browsing history may be collected and shared with our partners."}'
Invoke-WebRequest -Uri "http://localhost:8000/analyze-policy" -Method POST -Body $body -ContentType "application/json" | Select-Object -ExpandProperty Content
```

Expected response:
```json
{
  "risk_score": 72,
  "level": "HIGH",
  "clauses": [
    {"type": "Data Selling", "confidence": 0.92},
    {"type": "Behavioral Tracking", "confidence": 0.88},
    {"type": "Location Tracking", "confidence": 0.85}
  ],
  "explanation": "Significant risks detected. Your personal data may be sold to third parties..."
}
```

---

## 🔒 How It Works

### Stage 1 — Pre-Visit URL Protection
- `background.js` listens on `chrome.webNavigation.onBeforeNavigate`
- Sends URL to `/check-url` backend
- If risk score > 60 → redirects to `warning.html`
- User can **Go Back** or **Enter Anyway** (allowlisted for that tab)

### Stage 2 — T&C / Privacy Policy Analysis
- `content.js` runs on every page after DOM loads
- Detects T&C sections via heading keywords + CSS selectors
- Sends extracted text (up to 4,000 chars) to `/analyze-policy`
- Result stored in `chrome.storage.local` for the popup

### Stage 3 — Risk Display in Popup
- Popup reads stored analysis from `chrome.storage.local`
- Displays animated SVG risk ring (0–100 score)
- Lists detected clauses with confidence bars
- Human-readable explanation
- **Block Site** button redirects to `warning.html`

---

## 🤖 NLP Model

**Model**: `cross-encoder/nli-distilroberta-base`  
**Task**: Zero-shot classification (Natural Language Inference)  
**Clause types detected**:
- Data Selling
- Behavioral Tracking
- Location Tracking
- Auto-Renewing Subscriptions
- Arbitration Clause
- Liability Waiver
- Broad Data Sharing

> If the NLP model is unavailable, the system falls back to keyword-based heuristics automatically.

---

## ⚠️ Important Notes

1. **The backend must be running** before the extension can analyze sites.
2. The Chrome extension uses **Manifest V3** (service workers, not background pages).
3. CORS is fully configured — the extension can talk to `localhost:8000`.
4. The NLP model downloads to your HuggingFace cache (~`~/.cache/huggingface/`) on first run.
5. Risk threshold for blocking: **score > 60 out of 100**.
