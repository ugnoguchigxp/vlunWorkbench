FROM oven/bun:1.4.4

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/repo
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

ENTRYPOINT ["bun"]
