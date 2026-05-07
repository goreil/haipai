FROM python:3.12.8-slim-bookworm

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu sqlite3 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY db/ db/
COPY lib/ lib/
COPY routes/ routes/
COPY scripts/entrypoint.sh /entrypoint.sh
COPY static/ static/
COPY templates/ templates/
COPY riichi-mahjong-tiles/Regular/ riichi-mahjong-tiles/Regular/

# Create non-root user with a home dir (gunicorn needs it) and data directories
RUN useradd -r -u 1000 -m -s /bin/false appuser \
    && mkdir -p mortal_analysis data \
    && chown -R appuser:appuser /app

ENV DB_PATH=/app/data/games.db
ENV PYTHONUNBUFFERED=1

RUN chmod +x /entrypoint.sh

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "app:app"]
