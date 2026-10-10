FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=4 TOKENIZERS_PARALLELISM=false
WORKDIR /app
RUN useradd --create-home --uid 10001 app
COPY pyproject.toml ./
COPY backend ./backend
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir .
COPY data ./data
COPY reports ./reports
RUN mkdir -p /app/.runtime /app/data/.index && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "policylens.api:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
