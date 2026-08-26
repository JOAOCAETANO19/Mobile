# Backend Rhythm Dash: Node + yt-dlp + ffmpeg, pronto para Railway/Render/VPS.
FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/ ./server/
COPY package.json ./

ENV RD_PORT=8787
EXPOSE 8787

CMD ["node", "server/server.mjs"]
