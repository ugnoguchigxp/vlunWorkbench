FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

ARG TARGETARCH
ARG NODE_VERSION=24.18.0
ARG NPM_VERSION=12.0.1
ARG BUN_VERSION=1.3.14
ARG PYTEST_VERSION=9.1.1
ARG GO_VERSION=1.26.5
ARG GO_AMD64_SHA256=5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053
ARG GO_ARM64_SHA256=fe4789e92b1f33358680864bbe8704289e7bb5fc207d80623c308935bd696d49
ARG RUST_TOOLCHAIN=1.97.1

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
RUN pip3 install --break-system-packages --no-cache-dir "pytest==${PYTEST_VERSION}"

# Install checksum-verified Node.js
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) arch="x64" ;; \
      arm64) arch="arm64" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    asset="node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
    base="https://nodejs.org/dist/v${NODE_VERSION}"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o "/tmp/${asset}" "${base}/${asset}"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o /tmp/SHASUMS256.txt "${base}/SHASUMS256.txt"; \
    checksum="$(grep "  ${asset}$" /tmp/SHASUMS256.txt)"; test -n "${checksum}"; \
    echo "${checksum}" | (cd /tmp && sha256sum -c -); \
    tar -xJf "/tmp/${asset}" -C /usr/local --strip-components=1; \
    rm -f "/tmp/${asset}" /tmp/SHASUMS256.txt

RUN npm install --global "npm@${NPM_VERSION}" \
    && npm cache clean --force

# Install checksum-verified Bun
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) arch="x64" ;; \
      arm64) arch="aarch64" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    asset="bun-linux-${arch}.zip"; \
    base="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o "/tmp/${asset}" "${base}/${asset}"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o /tmp/SHASUMS256.txt "${base}/SHASUMS256.txt"; \
    checksum="$(grep "  ${asset}$" /tmp/SHASUMS256.txt)"; test -n "${checksum}"; \
    echo "${checksum}" | (cd /tmp && sha256sum -c -); \
    unzip -q "/tmp/${asset}" -d /tmp/bun; \
    install -m 0755 "/tmp/bun/bun-linux-${arch}/bun" /usr/local/bin/bun; \
    rm -rf "/tmp/${asset}" /tmp/SHASUMS256.txt /tmp/bun

# Install checksum-verified Go
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) arch="amd64"; expected_sha256="${GO_AMD64_SHA256}" ;; \
      arm64) arch="arm64"; expected_sha256="${GO_ARM64_SHA256}" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    asset="go${GO_VERSION}.linux-${arch}.tar.gz"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o "/tmp/${asset}" "https://go.dev/dl/${asset}"; \
    echo "${expected_sha256}  /tmp/${asset}" | sha256sum -c -; \
    tar -xzf "/tmp/${asset}" -C /usr/local; \
    rm -f "/tmp/${asset}"

# Install a checksum-verified rustup bootstrap and an explicit Rust toolchain
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:${PATH}
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) rust_arch="x86_64-unknown-linux-gnu" ;; \
      arm64) rust_arch="aarch64-unknown-linux-gnu" ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    base="https://static.rust-lang.org/rustup/dist/${rust_arch}/rustup-init"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o /tmp/rustup-init "${base}"; \
    curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 -o /tmp/rustup-init.sha256 "${base}.sha256"; \
    expected_sha256="$(cut -d ' ' -f 1 /tmp/rustup-init.sha256)"; \
    test "${#expected_sha256}" -eq 64; \
    echo "${expected_sha256}  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_TOOLCHAIN}"; \
    rm -f /tmp/rustup-init /tmp/rustup-init.sha256

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
