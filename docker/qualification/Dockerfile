FROM oven/bun:1.3.14

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/repo
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

ENTRYPOINT ["bun"]
