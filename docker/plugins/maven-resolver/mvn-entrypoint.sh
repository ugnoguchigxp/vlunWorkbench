#!/bin/sh
set -eu

local_repository=""
for argument in "$@"; do
	case "$argument" in
		-Dmaven.repo.local=/workspace/cache/*)
			local_repository=${argument#-Dmaven.repo.local=}
			;;
		-Dmaven.repo.local=*)
			echo "maven_resolver_cache_path_invalid" >&2
			exit 2
			;;
	esac
done

if [ -n "$local_repository" ]; then
	mkdir -p "$local_repository"
	jansi_directory="$local_repository/.jansi"
	mkdir -p "$jansi_directory"
	export MAVEN_OPTS="${MAVEN_OPTS:-} -Djansi.tmpdir=$jansi_directory"
	# Restore the image-owned plugin and all of its dependencies on every run.
	# The host creates a fresh scan-run-specific repository, and this copy also
	# prevents a repository-local artifact from replacing a plugin coordinate.
	cp -a /opt/vuln-workbench/maven-repository/. "$local_repository/"
fi

exec /usr/share/maven/bin/mvn "$@"
