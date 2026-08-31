FROM golang:1.27.0-bookworm@sha256:ded31c68586d2e49e760acc2e65a884b23d032e9bbbed0ae0c55abd3fcaf4452 AS patched-tools

ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SOURCE_COMMIT=83d9cd684c87d95d656c1458ef04895a7f1cbd8e
ARG GITLEAKS_SOURCE_SHA256=6b2638a733b85619dc80bdf28e84e4fed7e526a761ab5c148fbf67695aea2115
ARG OSV_SCANNER_VERSION=2.4.0
ARG OSV_SCANNER_SOURCE_COMMIT=b56b5191101d5f27d4787d5583d8d01e9518a7af
ARG OSV_SCANNER_SOURCE_SHA256=76d55cde9bbef2e3ecdb441dfe387d027937536432c1c78441cee0f4d83bf7a4
ARG NUCLEI_VERSION=3.11.1
ARG NUCLEI_SOURCE_COMMIT=a8c88feb4a1c8e961b7902534ce3af97e9d524a4
ARG NUCLEI_SOURCE_SHA256=233fd559f0f2287310709ed0f19613a9e298dbff03ee7f9e0905a0709e8537e4
ARG COSIGN_VERSION=3.1.3
ARG COSIGN_SOURCE_COMMIT=11926fa5bbbbde47e88fc006b625a17769b743b2
ARG COSIGN_SOURCE_SHA256=3a718446bac51466efff6853639e1ca108b456ecbf07cd92938f548715d22d6b
ARG SLSA_VERIFIER_VERSION=2.7.1
ARG SLSA_VERIFIER_SOURCE_COMMIT=ea584f4502babc6f60d9bc799dbbb13c1caa9ee6
ARG SLSA_VERIFIER_SOURCE_SHA256=c1ed640d3f775d09549488d120f7d02694c1bbf5bf885c302a7916660c62056d

ENV CGO_ENABLED=0 \
	GOTOOLCHAIN=local

RUN mkdir -p /out /src/gitleaks \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/gitleaks.tar.gz "https://codeload.github.com/gitleaks/gitleaks/tar.gz/${GITLEAKS_SOURCE_COMMIT}" \
	&& echo "${GITLEAKS_SOURCE_SHA256}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/gitleaks.tar.gz -C /src/gitleaks --strip-components=1 \
	&& cd /src/gitleaks \
	&& go get golang.org/x/crypto@v0.52.0 golang.org/x/text@v0.39.0 \
	&& go build -trimpath -buildvcs=false \
		-ldflags "-s -w -X=github.com/zricethezav/gitleaks/v8/version.Version=${GITLEAKS_VERSION}" \
		-o /out/gitleaks .

RUN mkdir -p /src/osv-scanner \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/osv-scanner.tar.gz "https://codeload.github.com/google/osv-scanner/tar.gz/${OSV_SCANNER_SOURCE_COMMIT}" \
	&& echo "${OSV_SCANNER_SOURCE_SHA256}  /tmp/osv-scanner.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/osv-scanner.tar.gz -C /src/osv-scanner --strip-components=1 \
	&& cd /src/osv-scanner \
	&& go get google.golang.org/grpc@v1.82.1 github.com/go-git/go-git/v5@v5.19.2 golang.org/x/net@v0.56.0 golang.org/x/text@v0.39.0 \
	&& go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/osv-scanner ./cmd/osv-scanner

RUN mkdir -p /src/nuclei \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/nuclei.tar.gz "https://codeload.github.com/projectdiscovery/nuclei/tar.gz/${NUCLEI_SOURCE_COMMIT}" \
	&& echo "${NUCLEI_SOURCE_SHA256}  /tmp/nuclei.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/nuclei.tar.gz -C /src/nuclei --strip-components=1 \
	&& cd /src/nuclei \
	&& go get github.com/go-git/go-git/v5@v5.19.2 \
	&& go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/nuclei ./cmd/nuclei

RUN mkdir -p /src/cosign \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/cosign.tar.gz "https://codeload.github.com/sigstore/cosign/tar.gz/${COSIGN_SOURCE_COMMIT}" \
	&& echo "${COSIGN_SOURCE_SHA256}  /tmp/cosign.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/cosign.tar.gz -C /src/cosign --strip-components=1 \
	&& cd /src/cosign \
	&& go build -trimpath -buildvcs=false \
		-ldflags "-s -w -buildid= -X sigs.k8s.io/release-utils/version.gitVersion=v${COSIGN_VERSION} -X sigs.k8s.io/release-utils/version.gitCommit=${COSIGN_SOURCE_COMMIT} -X sigs.k8s.io/release-utils/version.gitTreeState=clean" \
		-o /out/cosign ./cmd/cosign

RUN mkdir -p /src/slsa-verifier \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/slsa-verifier.tar.gz "https://codeload.github.com/slsa-framework/slsa-verifier/tar.gz/${SLSA_VERIFIER_SOURCE_COMMIT}" \
	&& echo "${SLSA_VERIFIER_SOURCE_SHA256}  /tmp/slsa-verifier.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/slsa-verifier.tar.gz -C /src/slsa-verifier --strip-components=1 \
	&& cd /src/slsa-verifier \
	&& go build -trimpath -buildvcs=false \
		-ldflags "-s -w -buildid= -X sigs.k8s.io/release-utils/version.gitVersion=v${SLSA_VERIFIER_VERSION} -X sigs.k8s.io/release-utils/version.gitCommit=${SLSA_VERIFIER_SOURCE_COMMIT} -X sigs.k8s.io/release-utils/version.gitTreeState=clean" \
		-o /out/slsa-verifier ./cli/slsa-verifier

FROM golang:1.27.0-bookworm@sha256:ded31c68586d2e49e760acc2e65a884b23d032e9bbbed0ae0c55abd3fcaf4452 AS trivy-binary

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
	&& go get github.com/containerd/containerd/v2@v2.3.2 github.com/go-git/go-git/v5@v5.19.2 google.golang.org/grpc@v1.82.1 golang.org/x/net@v0.56.0 golang.org/x/text@v0.39.0 oras.land/oras-go/v2@v2.6.2 \
	&& GOEXPERIMENT=jsonv2 go build -trimpath -buildvcs=false \
		-ldflags "-s -w -X github.com/aquasecurity/trivy/pkg/version/app.ver=${TRIVY_VERSION}" \
		-o /trivy ./cmd/trivy

FROM python:3.14-slim-bookworm@sha256:23c59390fc717bf09f9336908199a0ae75d9c4264bf296123f94ad772fea3b52

ARG TARGETARCH
ARG SCHEMATHESIS_VERSION=4.24.2
ARG ZIZMOR_VERSION=1.29.0
ARG ZIZMOR_SOURCE_COMMIT=3c116961091b50bd1a08ffefe916469d4d90093c
ARG ZIZMOR_SHA256_AMD64=dd96df044a6e8538d5f423790f453bdd03d49e5b2bcc38214acc41a2f1297839
ARG ZIZMOR_SHA256_ARM64=415eaa7c0a06479a701b8e44a3e812c1047decc848ec4bede7bd6bbf49f22d20
ARG ZIZMOR_LICENSE_SHA256=a6fd1bd18da7cec8284639d5b0d351b90934317be1b9f9ea94a077621c6f35af

LABEL org.opencontainers.image.title="vulnWorkbench toolbox"
LABEL org.opencontainers.image.description="Core toolbox image for Gitleaks, OSV-Scanner, Trivy, zizmor, Nuclei, Schemathesis, Cosign, and slsa-verifier"
LABEL vuln-workbench.toolbox.version="2"
LABEL vuln-workbench.scanner.cosign.version="3.1.3"
LABEL vuln-workbench.scanner.cosign.license="Apache-2.0"
LABEL vuln-workbench.scanner.zizmor.version="1.29.0"
LABEL vuln-workbench.scanner.zizmor.license="MIT"
LABEL vuln-workbench.scanner.slsa-verifier.version="2.7.1"
LABEL vuln-workbench.scanner.slsa-verifier.license="Apache-2.0"

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git tar gzip unzip \
	&& rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
		amd64) zizmor_arch="x86_64"; zizmor_sha="${ZIZMOR_SHA256_AMD64}" ;; \
		arm64) zizmor_arch="aarch64"; zizmor_sha="${ZIZMOR_SHA256_ARM64}" ;; \
		*) echo "Unsupported TARGETARCH for zizmor: ${TARGETARCH}" >&2; exit 1 ;; \
	esac \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 300 \
		-o /tmp/zizmor.tar.gz "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${zizmor_arch}-unknown-linux-gnu.tar.gz" \
	&& echo "${zizmor_sha}  /tmp/zizmor.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/zizmor.tar.gz -C /usr/local/bin zizmor \
	&& chmod 0755 /usr/local/bin/zizmor \
	&& mkdir -p /usr/share/licenses/zizmor \
	&& curl -fsSL --retry 5 --retry-all-errors --connect-timeout 15 --max-time 60 \
		-o /usr/share/licenses/zizmor/LICENSE "https://raw.githubusercontent.com/zizmorcore/zizmor/${ZIZMOR_SOURCE_COMMIT}/LICENSE" \
	&& echo "${ZIZMOR_LICENSE_SHA256}  /usr/share/licenses/zizmor/LICENSE" | sha256sum -c - \
	&& rm -f /tmp/zizmor.tar.gz

COPY --from=patched-tools /out/gitleaks /out/osv-scanner /out/nuclei /out/cosign /out/slsa-verifier /usr/local/bin/
COPY --from=patched-tools /src/cosign/LICENSE /src/cosign/COPYRIGHT.txt /usr/share/licenses/cosign/
COPY --from=patched-tools /src/slsa-verifier/LICENSE /usr/share/licenses/slsa-verifier/
COPY --from=trivy-binary /trivy /usr/local/bin/trivy

RUN python -m venv /opt/schemathesis \
	&& /opt/schemathesis/bin/pip install --no-cache-dir "schemathesis==${SCHEMATHESIS_VERSION}" \
	&& ln -s /opt/schemathesis/bin/st /usr/local/bin/st \
	&& command -v st

COPY docker/toolbox/schemathesis-readonly-gateway.py /usr/local/bin/vwb-schemathesis-readonly-gateway
RUN chmod 0755 /usr/local/bin/vwb-schemathesis-readonly-gateway

COPY docker/toolbox/nuclei-safe-templates /opt/vuln-workbench/nuclei-safe-templates
COPY --from=scanner-data / /opt/vuln-workbench/scanner-data

# Trivy persists its per-scan fanal cache beside the immutable offline DB. The
# scanner remains uid 65532 under the Docker runner's constrained policy; this
# only permits copy-on-write cache entries in the ephemeral container layer.
RUN mkdir -p /workspace/repo /workspace/out /workspace/cache \
	&& mkdir -p /workspace/cache/.cache \
	&& ln -s /opt/vuln-workbench/scanner-data/osv/osv-scanner /workspace/cache/.cache/osv-scanner \
	&& chmod -R a+rX /opt/vuln-workbench/scanner-data \
	&& chmod -R a+rwX /opt/vuln-workbench/scanner-data/trivy \
	&& chown -R 65532:65532 /workspace

ENV HOME=/workspace/cache \
	XDG_CACHE_HOME=/workspace/cache/.cache \
	OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/opt/vuln-workbench/scanner-data/osv

USER 65532:65532
WORKDIR /workspace/repo

CMD ["gitleaks", "version"]
