#!/opt/schemathesis/bin/python
"""Run Schemathesis through a bounded loopback proxy inside its network namespace."""

from __future__ import annotations

import http.client
import json
import os
import re
import stat
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, unquote_plus, urlsplit

from graphql import OperationType, parse

HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
SECRET_HEADERS = {
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
}
GRAPHQL_PAYLOAD_KEYS = {"query", "variables", "operationName"}
FORBIDDEN_JSON_KEYS = {"__proto__", "constructor", "prototype"}


def fail(message: str) -> None:
    raise ValueError(message)


def strict_json_loads(source: str):
    def object_from_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result or key in FORBIDDEN_JSON_KEYS:
                fail("gateway_json_object_invalid")
            result[key] = value
        return result

    return json.loads(
        source,
        object_pairs_hook=object_from_pairs,
        parse_constant=lambda _value: fail("gateway_json_number_invalid"),
    )


def read_bounded_regular_file(file_path: str, max_bytes: int) -> bytes:
    path = Path(file_path)
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        fail("gateway_policy_regular_file_required")
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if not stat.S_ISREG(opened.st_mode):
            fail("gateway_policy_regular_file_required")
        if opened.st_size > max_bytes:
            fail("gateway_policy_size_exceeded")
        raw = handle.read(opened.st_size + 1)
        if len(raw) != opened.st_size:
            fail("gateway_policy_changed")
        return raw


def load_policy(policy_path: str) -> dict:
    raw = read_bounded_regular_file(policy_path, 1_048_576)
    policy = strict_json_loads(raw.decode("utf-8"))
    if not isinstance(policy, dict) or policy.get("schemaVersion") != 1:
        fail("gateway_policy_invalid")
    upstream = urlsplit(policy.get("upstreamOrigin", ""))
    if (
        upstream.scheme != "http"
        or upstream.hostname not in {"127.0.0.1", "localhost"}
        or not upstream.port
        or upstream.path not in {"", "/"}
        or upstream.query
        or upstream.fragment
        or upstream.username
        or upstream.password
    ):
        fail("gateway_upstream_invalid")
    operations = policy.get("operations")
    if not isinstance(operations, list) or not operations or len(operations) > 10_000:
        fail("gateway_operations_invalid")
    for operation in operations:
        if (
            not isinstance(operation, dict)
            or operation.get("method") not in {"GET", "HEAD", "OPTIONS", "POST"}
            or not isinstance(operation.get("pathTemplate"), str)
            or not operation["pathTemplate"].startswith("/")
        ):
            fail("gateway_operation_invalid")
    auth_headers = policy.get("authHeaders", {})
    if not isinstance(auth_headers, dict):
        fail("gateway_auth_headers_invalid")
    normalized_auth_headers = {}
    for name, value in auth_headers.items():
        normalized = name.lower() if isinstance(name, str) else ""
        if (
            not isinstance(name, str)
            or not isinstance(value, str)
            or not re.fullmatch(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+", name)
            or normalized in HOP_HEADERS
            or normalized
            in {
                "content-type",
                "x-http-method",
                "x-http-method-override",
                "x-method-override",
            }
            or normalized in normalized_auth_headers
            or "\r" in value
            or "\n" in value
        ):
            fail("gateway_auth_header_invalid")
        normalized_auth_headers[normalized] = value
    policy["authHeaders"] = normalized_auth_headers
    for key, maximum in {
        "maxRequests": 1000,
        "maxRequestBytes": 1_048_576,
        "maxPathBytes": 8192,
        "maxPathSegmentBytes": 2048,
        "maxQueryParameters": 50,
        "maxQueryValueBytes": 4096,
        "maxQueryBytes": 16384,
        "maxRequestHeaderBytes": 16384,
        "maxResponseBytes": 1_048_576,
        "maxTotalResponseBytes": 67_108_864,
    }.items():
        value = policy.get(key)
        if not isinstance(value, int) or value < 1 or value > maximum:
            fail(f"gateway_{key}_invalid")
    rate = policy.get("rateLimitPerSecond")
    if not isinstance(rate, (int, float)) or rate <= 0 or rate > 100:
        fail("gateway_rate_invalid")
    timeout = policy.get("requestTimeoutSeconds")
    if not isinstance(timeout, (int, float)) or timeout <= 0 or timeout > 60:
        fail("gateway_timeout_invalid")
    if policy["maxPathSegmentBytes"] > policy["maxPathBytes"]:
        fail("gateway_path_segment_limit_invalid")
    graphql_query_only = policy.get("graphqlQueryOnly")
    graphql_endpoint = policy.get("graphqlEndpointPath")
    if graphql_query_only is True:
        if (
            not isinstance(graphql_endpoint, str)
            or operations != [{"method": "POST", "pathTemplate": graphql_endpoint}]
        ):
            fail("gateway_graphql_policy_invalid")
    elif graphql_query_only is not False or graphql_endpoint is not None:
        fail("gateway_graphql_policy_invalid")
    return policy


def decoded_segments(raw_path: str) -> list[str] | None:
    if not raw_path.startswith("/") or raw_path.startswith("//") or "//" in raw_path:
        return None
    if re.search(r"%(?![0-9a-f]{2})|%(?:2f|5c|00)", raw_path, re.IGNORECASE):
        return None
    result = []
    for raw_segment in raw_path.split("/")[1:]:
        try:
            segment = unquote(raw_segment, errors="strict")
        except UnicodeError:
            return None
        if segment in {".", ".."} or "/" in segment or "\\" in segment or "\0" in segment:
            return None
        result.append(segment)
    return result


def operation_matches(method: str, raw_path: str, operation: dict) -> bool:
    actual = decoded_segments(raw_path)
    if actual is None or method != operation["method"]:
        return False
    expected = operation["pathTemplate"].split("/")[1:]
    if len(actual) != len(expected):
        return False
    return all(
        bool(actual[index]) if re.fullmatch(r"\{[^{}]+\}", segment) else actual[index] == segment
        for index, segment in enumerate(expected)
    )


def request_within_limits(handler: BaseHTTPRequestHandler, split, policy: dict) -> bool:
    raw_path = split.path
    raw_query = split.query
    if (
        len(raw_path.encode("utf-8")) > policy["maxPathBytes"]
        or len(raw_query.encode("utf-8")) > policy["maxQueryBytes"]
    ):
        return False
    segments = decoded_segments(raw_path)
    if segments is None or any(
        len(segment.encode("utf-8")) > policy["maxPathSegmentBytes"]
        for segment in segments
    ):
        return False
    parameters = raw_query.split("&") if raw_query else []
    if len(parameters) > policy["maxQueryParameters"]:
        return False
    blocked_names = {
        "_method",
        "x-http-method",
        "x-http-method-override",
        "x-method-override",
    }
    for parameter in parameters:
        raw_name, separator, raw_value = parameter.partition("=")
        if re.search(r"%(?![0-9a-f]{2})", raw_name + raw_value, re.IGNORECASE):
            return False
        try:
            name = unquote_plus(raw_name, errors="strict")
            value = unquote_plus(raw_value if separator else "", errors="strict")
        except UnicodeError:
            return False
        if (
            name.lower() in blocked_names
            or len(value.encode("utf-8")) > policy["maxQueryValueBytes"]
        ):
            return False
    header_bytes = 2 + sum(
        len(name.encode("utf-8")) + len(value.encode("utf-8")) + 4
        for name, value in handler.headers.raw_items()
    ) + sum(
        len(name.encode("utf-8")) + len(value.encode("utf-8")) + 4
        for name, value in policy["authHeaders"].items()
    )
    return header_bytes <= policy["maxRequestHeaderBytes"]


def graphql_query_only(body: bytes) -> bool:
    try:
        payload = strict_json_loads(body.decode("utf-8"))
        if (
            not isinstance(payload, dict)
            or not set(payload).issubset(GRAPHQL_PAYLOAD_KEYS)
            or not isinstance(payload.get("query"), str)
        ):
            return False
        operation_name = payload.get("operationName")
        if operation_name is not None and (
            not isinstance(operation_name, str)
            or not re.fullmatch(r"[_A-Za-z][_0-9A-Za-z]{0,255}", operation_name)
        ):
            return False
        variables = payload.get("variables")
        if variables is not None and not isinstance(variables, dict):
            return False
        query = payload["query"]
        document = parse(query, max_tokens=100_000)
        operations = [
            definition
            for definition in document.definitions
            if definition.kind == "operation_definition"
        ]
        return bool(operations) and all(
            operation.operation == OperationType.QUERY for operation in operations
        ) and all(
            definition.kind in {"operation_definition", "fragment_definition"}
            for definition in document.definitions
        )
    except Exception:
        return False


class GatewayState:
    def __init__(self, policy: dict):
        self.policy = policy
        self.lock = threading.Lock()
        self.requests = 0
        self.total_response_bytes = 0
        self.last_request_at = 0.0

    def reserve(self) -> bool:
        with self.lock:
            if self.requests >= self.policy["maxRequests"]:
                return False
            delay = max(
                0.0,
                1.0 / self.policy["rateLimitPerSecond"] - (time.monotonic() - self.last_request_at),
            )
            if delay:
                time.sleep(delay)
            self.last_request_at = time.monotonic()
            self.requests += 1
            return True

    def record_response(self, size: int) -> bool:
        with self.lock:
            if self.total_response_bytes + size > self.policy["maxTotalResponseBytes"]:
                return False
            self.total_response_bytes += size
            return True


def handler_for(state: GatewayState):
    policy = state.policy
    upstream = urlsplit(policy["upstreamOrigin"])

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(policy["requestTimeoutSeconds"])

        def __getattr__(self, name: str):
            if name.startswith("do_"):
                return self.dispatch
            raise AttributeError(name)

        def log_message(self, _format: str, *_args) -> None:
            return

        def send_empty(self, status: int, allow: list[str] | None = None) -> None:
            self.send_response(status)
            self.send_header("Cache-Control", "no-store")
            if allow:
                self.send_header("Allow", ", ".join(sorted(set(allow))))
            self.send_header("Content-Length", "0")
            self.end_headers()

        def dispatch(self) -> None:
            split = urlsplit(self.path)
            if (
                split.scheme
                or split.netloc
                or split.fragment
                or not request_within_limits(self, split, policy)
            ):
                return self.send_empty(400)
            operation = next(
                (
                    candidate
                    for candidate in policy["operations"]
                    if operation_matches(self.command, split.path, candidate)
                ),
                None,
            )
            if operation is None:
                allowed = [
                    candidate["method"]
                    for candidate in policy["operations"]
                    if operation_matches(
                        candidate["method"], split.path, candidate
                    )
                ]
                return self.send_empty(405, allowed) if allowed else self.send_empty(404)
            if any(
                name in self.headers
                for name in {"X-HTTP-Method-Override", "X-Method-Override", "X-HTTP-Method"}
            ):
                return self.send_empty(405)
            body = b""
            if self.command == "POST":
                length_text = self.headers.get("Content-Length", "")
                if not length_text.isdigit() or int(length_text) > policy["maxRequestBytes"]:
                    return self.send_empty(413)
                try:
                    body = self.rfile.read(int(length_text))
                except (OSError, TimeoutError):
                    return self.send_empty(408)
                if (
                    len(body) != int(length_text)
                    or policy.get("graphqlQueryOnly") is not True
                    or re.match(
                        r"^application/json(?:\s*;|$)",
                        self.headers.get("Content-Type", ""),
                        re.IGNORECASE,
                    )
                    is None
                    or not graphql_query_only(body)
                ):
                    return self.send_empty(400)
            if not state.reserve():
                return self.send_empty(429)
            headers = {}
            connection_headers = {
                item.strip().lower()
                for item in self.headers.get("Connection", "").split(",")
                if item.strip()
            }
            for name, value in self.headers.items():
                normalized = name.lower()
                if normalized in HOP_HEADERS | SECRET_HEADERS | connection_headers:
                    continue
                headers[name] = value
            headers.update(policy["authHeaders"])
            connection = http.client.HTTPConnection(
                upstream.hostname,
                upstream.port,
                timeout=policy.get("requestTimeoutSeconds", 10),
            )
            try:
                connection.request(
                    self.command,
                    split.path + (("?" + split.query) if split.query else ""),
                    body=body or None,
                    headers=headers,
                )
                response = connection.getresponse()
                response_body = (
                    b""
                    if self.command == "HEAD"
                    else response.read(policy["maxResponseBytes"] + 1)
                )
                truncated = len(response_body) > policy["maxResponseBytes"]
                response_body = response_body[: policy["maxResponseBytes"]]
                if not state.record_response(len(response_body)):
                    return self.send_empty(429)
                self.send_response(response.status)
                response_connection_headers = {
                    item.strip().lower()
                    for item in (response.getheader("Connection") or "").split(",")
                    if item.strip()
                }
                for name, value in response.getheaders():
                    normalized = name.lower()
                    if (
                        normalized in HOP_HEADERS | response_connection_headers
                        or normalized == "location"
                    ):
                        continue
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(response_body)))
                if truncated:
                    self.send_header("X-Vuln-Workbench-Gateway-Body", "truncated")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(response_body)
            except Exception:
                self.send_empty(502)
            finally:
                connection.close()

        do_GET = dispatch
        do_HEAD = dispatch
        do_OPTIONS = dispatch
        do_POST = dispatch
        do_PUT = dispatch
        do_PATCH = dispatch
        do_DELETE = dispatch
        do_CONNECT = dispatch
        do_TRACE = dispatch

    return Handler


def main() -> int:
    if len(sys.argv) < 5 or sys.argv[1] != "run" or "--" not in sys.argv[3:]:
        print("readonly_gateway_usage_invalid", file=sys.stderr)
        return 2
    separator = sys.argv.index("--")
    try:
        policy = load_policy(sys.argv[2])
        command = sys.argv[separator + 1 :]
        url_index = command.index("--url") + 1
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 2
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(GatewayState(policy)))
    server.daemon_threads = True
    server.block_on_close = False
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    if policy.get("graphqlQueryOnly") is True:
        endpoint += policy["graphqlEndpointPath"]
    command[url_index] = endpoint
    try:
        return subprocess.run(["/usr/local/bin/st", *command], check=False).returncode
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
