# Minimal container for the zero-dependency territory-planning app.
# Stdlib-only, so no pip install. Cloud Run / fly.io set $PORT; the app reads
# $PORT and $HOST (must bind 0.0.0.0 to be reachable in a container). Basic auth
# activates in the container via BASIC_AUTH_PASS (set as a deploy secret).
#
# The container filesystem resets on every restart and deploy. To keep the
# decisions people make on the deployed app, mount a volume and set DATA_DIR to
# it (fly.io: a [mounts] section plus DATA_DIR in [env]). The app seeds the
# volume from the files in this image and replays changes.jsonl on start.
# Without DATA_DIR, decisions last only until the instance recycles.
FROM python:3.12-slim
WORKDIR /app
COPY . /app
ENV HOST=0.0.0.0
CMD ["python", "app.py"]
