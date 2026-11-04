# syntax=docker/dockerfile:1
# Runtime versions stay on Node 24 / CPython 3.12; app/Python dependencies are locked.
ARG NODE_IMAGE=node:24-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
FROM ${NODE_IMAGE} AS node-runtime
FROM ${PYTHON_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libatomic1 libgomp1 libglib2.0-0 tini && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2

FROM base AS web-build
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY application/package.json application/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY application/ ./
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf .next/cache

FROM base AS face-build
COPY application/face-engine/ ./face-engine/
COPY application/scripts/fetch-deployment-models.py ./scripts/fetch-deployment-models.py
RUN python -m venv /app/.venv-face && /app/.venv-face/bin/python -m pip install --only-binary=:all: --require-hashes --no-cache-dir -r face-engine/requirements.lock
RUN /app/.venv-face/bin/python scripts/fetch-deployment-models.py && /app/.venv-face/bin/python face-engine/manage.py smoke
RUN /app/.venv-face/bin/python -c "import sys;sys.path.insert(0,'face-engine/pad');from pad_engine import PadEngine;PadEngine().smoke();print('Pinned PAD models load on CPU; biometric reliability remains unvalidated.')"

FROM base AS runtime
RUN groupadd --gid 10001 fras && useradd --uid 10001 --gid fras --create-home fras
COPY --from=web-build --chown=fras:fras /app/package.json /app/package-lock.json ./
COPY --from=web-build --chown=fras:fras /app/node_modules ./node_modules
COPY --from=web-build --chown=fras:fras /app/.next ./.next
COPY --chown=fras:fras deployment/next.config.mjs ./next.config.mjs
COPY --from=web-build --chown=fras:fras /app/public ./public
COPY --from=web-build --chown=fras:fras /app/lib ./lib
COPY --from=web-build --chown=fras:fras /app/db ./db
COPY --from=web-build --chown=fras:fras /app/scripts ./scripts
COPY --from=face-build --chown=fras:fras /app/.venv-face ./.venv-face
COPY --from=face-build --chown=fras:fras /app/face-engine ./face-engine
USER fras
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Liveness only; database/clock configuration is checked by the startup script.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node","scripts/container-health.mjs"]
ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["node","scripts/container-start.mjs"]
