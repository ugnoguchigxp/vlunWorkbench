ARG BASE_IMAGE=vuln-workbench-toolbox:local
FROM ${BASE_IMAGE}

ARG SEMGREP_VERSION=1.171.0

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
	&& ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
	&& ln -s /opt/semgrep/bin/pysemgrep /usr/local/bin/pysemgrep

COPY docker/toolbox/scanner-data/semgrep-rules /opt/vuln-workbench/scanner-data/semgrep-rules

ENV SEMGREP_ENABLE_VERSION_CHECK=0 \
	SEMGREP_SEND_METRICS=off

USER 65532:65532

CMD ["semgrep", "--version"]
