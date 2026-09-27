# Development Dockerfile — Backend

FROM python:3.13-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy the backend before installing: hatchling's editable install builds
# metadata that requires README.md and the app/ package to exist. Copying
# pyproject.toml alone failed with "Readme file does not exist".
COPY backend/ .

# Install Python dependencies
RUN pip install --no-cache-dir -e ".[dev]"

EXPOSE 8000

CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
