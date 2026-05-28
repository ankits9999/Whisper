#!/usr/bin/env bash
# Setup script for the IndicConformer Hindi ASR microservice.
# Run once before starting asr_server.py for the first time.

set -euo pipefail

echo ""
echo "══════════════════════════════════════════════"
echo "  IndicConformer Hindi ASR — Setup"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. PyTorch (CPU) ──────────────────────────────────────────────────────────
echo "[1/3] Installing PyTorch (CPU-only)…"
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# ── 2. AI4Bharat NeMo fork ────────────────────────────────────────────────────
echo ""
echo "[2/3] Installing AI4Bharat NeMo fork (nemo-v2 branch)…"
if [ ! -d "NeMo" ]; then
    git clone https://github.com/AI4Bharat/NeMo.git
fi
cd NeMo
git fetch origin
git checkout nemo-v2
bash reinstall.sh
cd ..

# ── 3. Remaining dependencies ─────────────────────────────────────────────────
echo ""
echo "[3/3] Installing remaining Python dependencies…"
pip install -r requirements.txt

echo ""
echo "══════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Start the ASR server:   python asr_server.py"
echo "  Start the Node.js app:  npm start"
echo ""
echo "  The Hindi model (~500 MB) will be downloaded"
echo "  from HuggingFace on the first run."
echo "══════════════════════════════════════════════"
echo ""
