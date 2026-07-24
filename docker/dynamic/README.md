# vulnWorkbench Dynamic Sandbox Image

This directory contains the Dockerfile for the sandbox environment used to execute dynamic profile checks (test, sanitizer, and lightweight fuzz targets) in `vulnWorkbench`.

## Contents

The image (`vuln-workbench-dynamic:local`) includes:
- **NodeJS / npm** (Node 20)
- **Bun** (Latest)
- **Python / pytest** (Python 3.12, pytest)
- **Go** (Go 1.22)
- **Rust / cargo** (Stable Rust toolchain)
- **Build Essentials** (make, gcc, headers, etc. for compiling tests/fuzzers)

## Security Constraints

- Runs as a non-privileged user (`65532:65532`).
- Drop all capabilities (`--cap-drop ALL`).
- No new privileges (`--security-opt no-new-privileges`).
- Writable paths are restricted to `/tmp` (tmpfs) and `/workspace/out` (bound to host output).
- Workspace code root `/workspace/repo` is mounted strictly read-only (`ro`).

## Build

You can build the image using:
```bash
bun run docker:dynamic:build
```
The image pins its base digest and installs explicit, checksum-verified Node,
Bun, Go, and Rust versions for `linux/amd64` and `linux/arm64`.

Run the sandbox with the minimum capabilities and only the network mode required
by the selected profile:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  vuln-workbench-dynamic:local
```
