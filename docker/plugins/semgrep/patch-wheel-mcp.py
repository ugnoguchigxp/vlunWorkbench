#!/usr/bin/env python3
"""Rebind Semgrep's exact MCP requirement and repair the wheel RECORD."""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import pathlib
import sys
import zipfile

OLD_REQUIREMENT = b"Requires-Dist: mcp==1.23.3"
NEW_REQUIREMENT = b"Requires-Dist: mcp==1.28.1"


def record_digest(data: bytes) -> str:
	encoded = base64.urlsafe_b64encode(hashlib.sha256(data).digest())
	return f"sha256={encoded.rstrip(b'=').decode('ascii')}"


def patch_wheel(source: pathlib.Path, output_directory: pathlib.Path) -> pathlib.Path:
	with zipfile.ZipFile(source) as archive:
		infos = archive.infolist()
		members = {info.filename: archive.read(info.filename) for info in infos}

	metadata_paths = [name for name in members if name.endswith(".dist-info/METADATA")]
	record_paths = [name for name in members if name.endswith(".dist-info/RECORD")]
	if len(metadata_paths) != 1 or len(record_paths) != 1:
		raise RuntimeError("semgrep_wheel_metadata_layout_invalid")

	metadata_path = metadata_paths[0]
	record_path = record_paths[0]
	metadata = members[metadata_path]
	if metadata.count(OLD_REQUIREMENT) != 1 or NEW_REQUIREMENT in metadata:
		raise RuntimeError("semgrep_wheel_mcp_requirement_unexpected")
	metadata = metadata.replace(OLD_REQUIREMENT, NEW_REQUIREMENT)
	members[metadata_path] = metadata

	rows = list(csv.reader(io.StringIO(members[record_path].decode("utf-8"))))
	matched = 0
	for row in rows:
		if row and row[0] == metadata_path:
			row[1:] = [record_digest(metadata), str(len(metadata))]
			matched += 1
	if matched != 1:
		raise RuntimeError("semgrep_wheel_record_missing_metadata")
	record_buffer = io.StringIO(newline="")
	csv.writer(record_buffer, lineterminator="\n").writerows(rows)
	members[record_path] = record_buffer.getvalue().encode("utf-8")

	output_directory.mkdir(parents=True, exist_ok=True)
	destination = output_directory / source.name
	with zipfile.ZipFile(destination, "w") as archive:
		for info in infos:
			archive.writestr(info, members[info.filename])

	with zipfile.ZipFile(destination) as archive:
		patched = archive.read(metadata_path)
		if OLD_REQUIREMENT in patched or patched.count(NEW_REQUIREMENT) != 1:
			raise RuntimeError("semgrep_wheel_mcp_patch_verification_failed")
	return destination


if __name__ == "__main__":
	if len(sys.argv) != 3:
		raise SystemExit("usage: patch-wheel-mcp.py INPUT_WHEEL OUTPUT_DIRECTORY")
	result = patch_wheel(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
	print(result)
