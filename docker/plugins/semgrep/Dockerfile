ARG BASE_IMAGE=vuln-workbench-toolbox:local
FROM ${BASE_IMAGE}

ARG SEMGREP_VERSION=1.171.0
ARG JARACO_CONTEXT_VERSION=6.1.0
ARG WHEEL_VERSION=0.46.2

LABEL org.opencontainers.image.title="vulnWorkbench optional Semgrep adapter image"
LABEL org.opencontainers.image.description="Core toolbox extended with the optional LGPL Semgrep engine"
LABEL vuln-workbench.scanner-adapter="semgrep"
LABEL vuln-workbench.scanner-adapter.license="LGPL-2.1-or-later"

USER root

# Semgrep 1.171.0 pins a vulnerable MCP release exactly. Repack only its wheel
# requirement metadata, including RECORD, so pip can resolve and check MCP 1.28.1.
COPY docker/plugins/semgrep/patch-wheel-mcp.py /tmp/patch-wheel-mcp.py

RUN python -m venv /opt/semgrep \
	&& mkdir -p /tmp/semgrep-wheel /tmp/semgrep-patched \
	&& /opt/semgrep/bin/pip download --no-cache-dir --no-deps --only-binary=:all: \
		--dest /tmp/semgrep-wheel "semgrep==${SEMGREP_VERSION}" \
	&& python /tmp/patch-wheel-mcp.py \
		/tmp/semgrep-wheel/semgrep-*.whl /tmp/semgrep-patched \
	&& /opt/semgrep/bin/pip install --no-cache-dir \
		"setuptools==80.9.0" \
		"mcp==1.28.1" \
		"msgpack==1.2.1" \
		/tmp/semgrep-patched/semgrep-*.whl \
	&& /opt/semgrep/bin/pip check \
	&& /opt/semgrep/bin/python -c "from importlib.metadata import version; assert version('setuptools') == '80.9.0'; assert version('mcp') == '1.28.1'; assert version('msgpack') == '1.2.1'" \
	# Keep setuptools 80.9.0 while replacing the two vulnerable libraries it
	# vendors with their fixed implementations and matching package metadata.
	&& /opt/semgrep/bin/pip install --no-cache-dir --no-deps \
		--target /tmp/setuptools-vendor \
		"jaraco.context==${JARACO_CONTEXT_VERSION}" \
		"wheel==${WHEEL_VERSION}" \
	&& setuptools_vendor=/opt/semgrep/lib/python3.14/site-packages/setuptools/_vendor \
	&& rm -rf \
		"${setuptools_vendor}/jaraco/context.py" \
		"${setuptools_vendor}/jaraco/__pycache__/context.cpython-314.pyc" \
		"${setuptools_vendor}/jaraco.context-5.3.0.dist-info" \
		"${setuptools_vendor}/wheel" \
		"${setuptools_vendor}/wheel-0.45.1.dist-info" \
	&& cp -a /tmp/setuptools-vendor/jaraco/context "${setuptools_vendor}/jaraco/context" \
	&& cp -a "/tmp/setuptools-vendor/jaraco_context-${JARACO_CONTEXT_VERSION}.dist-info" "${setuptools_vendor}/" \
	&& cp -a /tmp/setuptools-vendor/wheel "${setuptools_vendor}/wheel" \
	&& cp -a "/tmp/setuptools-vendor/wheel-${WHEEL_VERSION}.dist-info" "${setuptools_vendor}/" \
	&& /opt/semgrep/bin/python -c "from setuptools._vendor.jaraco import context; from setuptools._vendor import wheel; assert context.__file__.endswith('/context/__init__.py'); assert wheel.__version__ == '${WHEEL_VERSION}'" \
	# Exclude pip's build-environment BOM; the generated image SBOM is the
	# authoritative inventory and records the installed runtime packages.
	&& find /opt/semgrep/lib/python3.14/site-packages \
		-type f -path '*/pip/_vendor/bom.cdx.json' -delete \
	&& rm -rf /tmp/semgrep-wheel /tmp/semgrep-patched /tmp/setuptools-vendor /tmp/patch-wheel-mcp.py \
	&& ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
	&& ln -s /opt/semgrep/bin/pysemgrep /usr/local/bin/pysemgrep

COPY docker/toolbox/scanner-data/semgrep-rules /opt/vuln-workbench/scanner-data/semgrep-rules

ENV SEMGREP_ENABLE_VERSION_CHECK=0 \
	SEMGREP_SEND_METRICS=off

USER 65532:65532

CMD ["semgrep", "--version"]
