FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

RUN groupadd --gid 10001 appuser \
	&& useradd --uid 10001 --gid appuser --create-home --shell /usr/sbin/nologin appuser \
	&& mkdir -p /data \
	&& chown -R appuser:appuser /app /data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173
ENV DATABASE_URL=/data/sqlite.db

EXPOSE 5173

USER appuser

CMD ["sh", "-c", "bun run db:migrate && bun run start"]
