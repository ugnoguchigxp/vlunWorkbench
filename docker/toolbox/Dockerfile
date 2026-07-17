FROM python:3.12-slim-bookworm

ARG TARGETARCH
ARG SEMGREP_VERSION=1.99.0
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_SCANNER_VERSION=2.4.0
ARG TRIVY_VERSION=0.71.2
ARG NUCLEI_VERSION=3.8.0
ARG SCHEMATHESIS_VERSION=4.22.4

LABEL org.opencontainers.image.title="vulnWorkbench toolbox"
LABEL org.opencontainers.image.description="Toolbox image for Semgrep, Gitleaks, OSV-Scanner, Trivy, Nuclei, and Schemathesis"
LABEL vuln-workbench.toolbox.version="2"

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git tar gzip unzip \
	&& rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/semgrep \
	&& /opt/semgrep/bin/pip install --no-cache-dir "setuptools<81" "semgrep==${SEMGREP_VERSION}" \
	&& ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
	&& ln -s /opt/semgrep/bin/pysemgrep /usr/local/bin/pysemgrep

RUN set -eux; \
	target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
	case "${target_arch}" in \
		amd64) arch="x64" ;; \
		arm64) arch="arm64" ;; \
		*) echo "unsupported arch: ${target_arch}" >&2; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz" \
		| tar -xz -C /usr/local/bin gitleaks; \
	chmod +x /usr/local/bin/gitleaks

RUN set -eux; \
	target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
	case "${target_arch}" in \
		amd64) arch="amd64" ;; \
		arm64) arch="arm64" ;; \
		*) echo "unsupported arch: ${target_arch}" >&2; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${arch}" \
		-o /usr/local/bin/osv-scanner; \
	chmod +x /usr/local/bin/osv-scanner

RUN set -eux; \
	target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
	case "${target_arch}" in \
		amd64) arch="64bit" ;; \
		arm64) arch="ARM64" ;; \
		*) echo "unsupported arch: ${target_arch}" >&2; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${arch}.tar.gz" \
		| tar -xz -C /usr/local/bin trivy; \
	chmod +x /usr/local/bin/trivy

RUN set -eux; \
	target_arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
	case "${target_arch}" in \
		amd64) arch="amd64" ;; \
		arm64) arch="arm64" ;; \
		*) echo "unsupported arch: ${target_arch}" >&2; exit 1 ;; \
	esac; \
	curl -fsSL "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${arch}.zip" -o /tmp/nuclei.zip; \
	unzip -q /tmp/nuclei.zip nuclei -d /usr/local/bin; \
	chmod +x /usr/local/bin/nuclei; \
	rm -f /tmp/nuclei.zip

RUN python -m venv /opt/schemathesis \
	&& /opt/schemathesis/bin/pip install --no-cache-dir "schemathesis==${SCHEMATHESIS_VERSION}" \
	&& ln -s /opt/schemathesis/bin/st /usr/local/bin/st \
	&& command -v st

COPY docker/toolbox/nuclei-safe-templates /opt/vuln-workbench/nuclei-safe-templates

RUN mkdir -p /workspace/repo /workspace/out /workspace/cache \
	&& chown -R 65532:65532 /workspace

USER 65532:65532
WORKDIR /workspace/repo

CMD ["semgrep", "--version"]
