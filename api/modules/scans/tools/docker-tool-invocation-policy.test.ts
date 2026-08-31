import { describe, expect, it } from "bun:test";
import { assertAllowedDockerInvocation } from "./docker-tool-invocation-policy";

const goal =
	"org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom";
const resolverTail = [
	"-DskipTests=true",
	"-DschemaVersion=1.6",
	"-DoutputFormat=json",
	"-DoutputName=maven-resolved.cdx",
	"-DoutputDirectory=/workspace/out",
	"-DincludeTestScope=true",
	"-DincludeBomSerialNumber=false",
	"-DoutputReactorProjects=false",
	"-Dcyclonedx.skipAttach=true",
	goal,
];

describe("Docker Maven invocation policy", () => {
	it("allows only the isolated aggregate SBOM invocation", () => {
		expect(() =>
			assertAllowedDockerInvocation("mvn", [
				"--batch-mode",
				"--no-transfer-progress",
				"--settings",
				"/tmp/settings.xml",
				"-f",
				"/repo/pom.xml",
				"-Dmaven.repo.local=/workspace/cache/maven/0123456789abcdef01234567/repository",
				"-Denv.VERSION=1.0.0-SNAPSHOT",
				...resolverTail,
			]),
		).not.toThrow();
	});

	it("rejects lifecycle goals and additional unapproved arguments", () => {
		expect(() =>
			assertAllowedDockerInvocation("mvn", ["--batch-mode", "package"]),
		).toThrow("package");
		expect(() =>
			assertAllowedDockerInvocation("mvn", [
				"--batch-mode",
				"exec:java",
				goal,
			]),
		).toThrow("exec:java");
		expect(() =>
			assertAllowedDockerInvocation("mvn", [
				"--batch-mode",
				"--no-transfer-progress",
				"--settings",
				"/tmp/settings.xml",
				"-f",
				"/repo/pom.xml",
				"-Dmaven.repo.local=/tmp/unbound-cache",
				...resolverTail,
			]),
		).toThrow("local repository path");
	});
});
