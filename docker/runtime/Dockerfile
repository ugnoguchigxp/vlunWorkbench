ARG BASE_IMAGE
ARG BUN_IMAGE
FROM ${BUN_IMAGE} AS bun-runtime

FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="vuln-workbench isolated runtime"
LABEL org.opencontainers.image.description="Locally qualified runtime image for isolated web diagnostics"

COPY --chmod=0555 docker/runtime/curl.mjs /usr/local/bin/curl
COPY --chmod=0555 docker/runtime/wget.mjs /usr/local/bin/wget
COPY --chmod=0444 docker/runtime/registry-proxy.mjs /opt/vuln-workbench-registry-proxy.mjs
COPY --from=bun-runtime --chmod=0555 /usr/local/bin/bun /usr/local/bin/bun

USER root
RUN rm -f /usr/local/bin/bunx \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && mkdir -p /opt/vuln-workbench-bun-bin \
    && ln -s /usr/local/bin/bun /opt/vuln-workbench-bun-bin/node
EXPOSE 4873
USER 1000:1000
CMD ["node", "/opt/vuln-workbench-registry-proxy.mjs"]
