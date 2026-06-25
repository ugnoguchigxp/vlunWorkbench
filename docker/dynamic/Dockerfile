FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="vulnWorkbench Dynamic Runner"
LABEL org.opencontainers.image.description="Dynamic sandbox environment containing Bun, Node, Python/pytest, Go, and Rust"
LABEL vuln-workbench.dynamic.version="1"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    unzip \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Pytest
RUN pip3 install --break-system-packages --no-cache-dir pytest

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash \
    && cp /root/.bun/bin/bun /usr/local/bin/

# Install Go (latest stable Go 1.22)
ARG GO_VERSION=1.22.4
RUN set -eux; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -xz -C /usr/local

# Install Rust (stable toolchain)
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path

# Configure temporary/cache directories for runtime writes as non-root user
ENV CARGO_HOME=/tmp/cargo \
    GOCACHE=/tmp/gocache \
    GOPATH=/tmp/gopath \
    HOME=/tmp

# Create workspace dirs and set up permissions
RUN mkdir -p /workspace/repo /workspace/workdir /workspace/out /workspace/cache \
    && chown -R 65532:65532 /workspace

USER 65532:65532
WORKDIR /workspace/workdir

# Smoke test runtimes
RUN node --version && npm --version && python3 --version && pytest --version && bun --version && go version && cargo --version

CMD ["/bin/sh"]
