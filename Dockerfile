# UZ-LANG STUDIO Worker
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp
RUN pip install --no-cache-dir yt-dlp==2024.8.6 faster-whisper==1.0.1 torch --extra-index-url https://download.pytorch.org/whl/cpu

# App
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app

CMD ["python", "worker.py"]