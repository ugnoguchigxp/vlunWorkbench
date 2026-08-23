ARG BASE_IMAGE
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="vuln-workbench isolated runtime"
LABEL org.opencontainers.image.description="Locally qualified runtime image for isolated web diagnostics"

COPY --chmod=0555 docker/runtime/curl.mjs /usr/local/bin/curl
COPY --chmod=0555 docker/runtime/wget.mjs /usr/local/bin/wget
COPY --chmod=0444 docker/runtime/registry-proxy.mjs /opt/vuln-workbench-registry-proxy.mjs

USER root
EXPOSE 4873
CMD ["node", "/opt/vuln-workbench-registry-proxy.mjs"]
