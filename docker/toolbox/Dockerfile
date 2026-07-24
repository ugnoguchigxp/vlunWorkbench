FROM golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651 AS patched-tools

ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SOURCE_COMMIT=83d9cd684c87d95d656c1458ef04895a7f1cbd8e
ARG GITLEAKS_SOURCE_SHA256=6b2638a733b85619dc80bdf28e84e4fed7e526a761ab5c148fbf67695aea2115
ARG OSV_SCANNER_VERSION=2.4.0
ARG OSV_SCANNER_SOURCE_COMMIT=b56b5191101d5f27d4787d5583d8d01e9518a7af
ARG OSV_SCANNER_SOURCE_SHA256=76d55cde9bbef2e3ecdb441dfe387d027937536432c1c78441cee0f4d83bf7a4
ARG NUCLEI_VERSION=3.11.0
ARG NUCLEI_SOURCE_COMMIT=57db38350267f0854bd58c633c29d168478a702f
ARG NUCLEI_SOURCE_SHA256=3fe1fc4930f99e440dd976b93ed89ad55ea5c31aa0406a51aceba32679f73c0a

ENV CGO_ENABLED=0 \
	GOTOOLCHAIN=local

RUN mkdir -p /out /src/gitleaks \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/gitleaks.tar.gz "https://codeload.github.com/gitleaks/gitleaks/tar.gz/${GITLEAKS_SOURCE_COMMIT}" \
	&& echo "${GITLEAKS_SOURCE_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/gitleaks.tar.gz -C /src/gitleaks --strip-components=1 \
	&& cd /src/gitleaks \
	&& go get golang.org/x/crypto@v0.52.0 \
	&& go build -trimpath -buildvcs=false \
		-ldflags "-s -w -X=github.com/zricethezav/gitleaks/v8/version.Version=${GITLEAKS_VERSION}" \
		-o /out/gitleaks .

RUN mkdir -p /src/osv-scanner \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/osv-scanner.tar.gz "https://codeload.github.com/google/osv-scanner/tar.gz/${OSV_SCANNER_SOURCE_COMMIT}" \
	&& echo "${OSV_SCANNER_SOURCE_SHA256}  /tmp/osv-scanner.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/osv-scanner.tar.gz -C /src/osv-scanner --strip-components=1 \
	&& cd /src/osv-scanner \
	&& go get google.golang.org/grpc@v1.82.1 \
	&& go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/osv-scanner ./cmd/osv-scanner

RUN mkdir -p /src/nuclei \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/nuclei.tar.gz "https://codeload.github.com/projectdiscovery/nuclei/tar.gz/${NUCLEI_SOURCE_COMMIT}" \
	&& echo "${NUCLEI_SOURCE_SHA256}  /tmp/nuclei.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/nuclei.tar.gz -C /src/nuclei --strip-components=1 \
	&& cd /src/nuclei \
	&& go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/nuclei ./cmd/nuclei

FROM golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651 AS trivy-binary

ARG TRIVY_VERSION=0.72.0
ARG TRIVY_SOURCE_COMMIT=8a32853686209a428179bb3a1688802b25691564
ARG TRIVY_SOURCE_SHA256=5a922c388846d11345ce8283e4373be312458f002abc667c3cd1f77c43163725

ENV CGO_ENABLED=0 \
	GOTOOLCHAIN=local

RUN mkdir -p /src/trivy \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/trivy.tar.gz "https://codeload.github.com/aquasecurity/trivy/tar.gz/${TRIVY_SOURCE_COMMIT}" \
	&& echo "${TRIVY_SOURCE_SHA256}  /tmp/trivy.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/trivy.tar.gz -C /src/trivy --strip-components=1 \
	&& cd /src/trivy \
	&& go get github.com/containerd/containerd/v2@v2.3.2 google.golang.org/grpc@v1.82.1 oras.land/oras-go/v2@v2.6.1 \
	&& GOEXPERIMENT=jsonv2 go build -trimpath -buildvcs=false \
		-ldflags "-s -w -X github.com/aquasecurity/trivy/pkg/version/app.ver=${TRIVY_VERSION}" \
		-o /trivy ./cmd/trivy

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ARG TARGETARCH
ARG SEMGREP_VERSION=1.171.0
ARG SCHEMATHESIS_VERSION=4.24.2

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

COPY --from=patched-tools /out/gitleaks /out/osv-scanner /out/nuclei /usr/local/bin/
COPY --from=trivy-binary /trivy /usr/local/bin/trivy

RUN python -m venv /opt/schemathesis \
	&& /opt/schemathesis/bin/pip install --no-cache-dir "schemathesis==${SCHEMATHESIS_VERSION}" \
	&& ln -s /opt/schemathesis/bin/st /usr/local/bin/st \
	&& command -v st

COPY docker/toolbox/nuclei-safe-templates /opt/vuln-workbench/nuclei-safe-templates

RUN mkdir -p /workspace/repo /workspace/out /workspace/cache \
	&& chown -R 65532:65532 /workspace

ENV HOME=/workspace/cache \
	XDG_CACHE_HOME=/workspace/cache/.cache \
	SEMGREP_ENABLE_VERSION_CHECK=0 \
	SEMGREP_SEND_METRICS=off

USER 65532:65532
WORKDIR /workspace/repo

CMD ["semgrep", "--version"]
