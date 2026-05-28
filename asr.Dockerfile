FROM python:3.10-slim

WORKDIR /app

# System deps:
#   build-essential  — compiles NeMo C extensions
#   git              — clones the NeMo fork
#   ffmpeg           — audio format conversion used by NeMo
#   libsndfile1(-dev)— soundfile read/write at runtime & compile time
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ffmpeg libsndfile1 libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU-only (install before NeMo so NeMo picks up the right torch)
RUN pip install --no-cache-dir \
    torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

# AI4Bharat NeMo fork — shallow clone to skip full git history
RUN git clone --depth 1 --branch nemo-v2 \
    https://github.com/AI4Bharat/NeMo.git /opt/NeMo \
    && pip install --no-cache-dir -e "/opt/NeMo[asr]"

# Runtime deps for asr_server.py
RUN pip install --no-cache-dir websockets numpy scipy soundfile

COPY asr_server.py .

EXPOSE 8765

# Server blocks on model load; the compose healthcheck polls port 8765
# and only marks the service healthy once the server starts accepting connections.
CMD ["python", "asr_server.py"]
