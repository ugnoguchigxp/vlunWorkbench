FROM maven:3.9.16-eclipse-temurin-17-noble@sha256:bbcab0adfb03704e65831593df63b1c6b7ee42d5d8603f0d88972e0ee81a3036

ARG CYCLONEDX_MAVEN_PLUGIN_VERSION=2.9.3

LABEL org.opencontainers.image.title="vulnWorkbench Maven dependency resolver"
LABEL org.opencontainers.image.description="Isolated Maven Central resolver producing a CycloneDX aggregate SBOM"
LABEL vuln-workbench.maven.version="3.9.16"
LABEL vuln-workbench.cyclonedx-maven-plugin.version="2.9.3"

USER root

RUN mkdir -p /opt/vuln-workbench/maven-repository \
	&& /usr/share/maven/bin/mvn --batch-mode --no-transfer-progress \
		-Dmaven.repo.local=/opt/vuln-workbench/maven-repository \
		org.apache.maven.plugins:maven-dependency-plugin:3.9.0:get \
		-Dartifact="org.cyclonedx:cyclonedx-maven-plugin:${CYCLONEDX_MAVEN_PLUGIN_VERSION}:maven-plugin" \
	&& chmod -R a+rX /opt/vuln-workbench/maven-repository \
	&& mkdir -p /workspace/repo /workspace/out /workspace/cache \
	&& chown -R 65532:65532 /workspace

COPY docker/plugins/maven-resolver/mvn-entrypoint.sh /usr/local/bin/mvn
COPY docker/plugins/maven-resolver/MavenCentralProxy.java /opt/vuln-workbench/MavenCentralProxy.java
RUN chmod 0755 /usr/local/bin/mvn \
	&& javac -d /opt/vuln-workbench /opt/vuln-workbench/MavenCentralProxy.java \
	&& rm /opt/vuln-workbench/MavenCentralProxy.java \
	&& chmod 0444 /opt/vuln-workbench/MavenCentralProxy.class

USER 65532:65532
WORKDIR /workspace/repo

ENTRYPOINT ["/usr/local/bin/mvn"]
CMD ["--version"]
