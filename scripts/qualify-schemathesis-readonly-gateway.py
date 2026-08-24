#!/usr/bin/env python3
"""Qualify the in-namespace Schemathesis read-only gateway in the toolbox image."""

from __future__ import annotations

import http.client
import importlib.util
import json
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.machinery import SourceFileLoader
from pathlib import Path


GATEWAY_PATH = "/usr/local/bin/vwb-schemathesis-readonly-gateway"
AUTH_VALUE = "Bearer qualification-secret-canary"


def load_gateway_module():
    loader = SourceFileLoader("vwb_readonly_gateway", GATEWAY_PATH)
    spec = importlib.util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise AssertionError("gateway_module_spec_missing")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class UpstreamState:
    def __init__(self) -> None:
        self.requests: list[dict[str, str]] = []
        self.lock = threading.Lock()

    def record(self, handler: BaseHTTPRequestHandler) -> None:
        with self.lock:
            self.requests.append(
                {
                    "method": handler.command,
                    "path": handler.path,
                    "authorization": handler.headers.get("Authorization", ""),
                }
            )


def upstream_handler(state: UpstreamState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args) -> None:
            return

        def respond(self) -> None:
            state.record(self)
            length = int(self.headers.get("Content-Length", "0"))
            if length:
                self.rfile.read(length)
            if self.path == "/graphql":
                body = b'{"data":{"health":"ok"}}'
            else:
                body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        do_GET = respond
        do_POST = respond

    return Handler


def start_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def stop_server(server: ThreadingHTTPServer, thread: threading.Thread) -> None:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def base_policy(upstream_origin: str) -> dict:
    return {
        "schemaVersion": 1,
        "upstreamOrigin": upstream_origin,
        "authHeaders": {"Authorization": AUTH_VALUE},
        "maxRequests": 30,
        "rateLimitPerSecond": 20,
        "requestTimeoutSeconds": 5,
        "maxRequestBytes": 65_536,
        "maxPathBytes": 8192,
        "maxPathSegmentBytes": 2048,
        "maxQueryParameters": 50,
        "maxQueryValueBytes": 4096,
        "maxQueryBytes": 16384,
        "maxRequestHeaderBytes": 16384,
        "maxResponseBytes": 65_536,
        "maxTotalResponseBytes": 1_048_576,
    }


def qualify_policy_file_bounds(gateway) -> dict:
    with tempfile.TemporaryDirectory(prefix="vwb-gateway-policy-") as temp:
        root = Path(temp)
        oversized = root / "oversized.json"
        with oversized.open("wb") as handle:
            handle.truncate(1_048_577)
        try:
            gateway.load_policy(str(oversized))
        except ValueError as error:
            if str(error) != "gateway_policy_size_exceeded":
                raise
        else:
            raise AssertionError("oversized_gateway_policy_accepted")

        target = root / "policy.json"
        target.write_text("{}", encoding="utf-8")
        link = root / "policy-link.json"
        link.symlink_to(target)
        try:
            gateway.load_policy(str(link))
        except ValueError as error:
            if str(error) != "gateway_policy_regular_file_required":
                raise
        else:
            raise AssertionError("symlink_gateway_policy_accepted")
    return {"oversizedRejected": True, "symlinkRejected": True}


def qualify_real_schemathesis() -> dict:
    upstream_state = UpstreamState()
    upstream, upstream_thread = start_server(upstream_handler(upstream_state))
    upstream_origin = f"http://127.0.0.1:{upstream.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="vwb-gateway-qualification-") as temp:
            root = Path(temp)
            schema_path = root / "openapi.json"
            policy_path = root / "policy.json"
            output_path = root / "report.ndjson"
            schema_path.write_text(
                json.dumps(
                    {
                        "openapi": "3.0.4",
                        "info": {"title": "Gateway qualification", "version": "1"},
                        "paths": {
                            "/health": {
                                "get": {
                                    "responses": {
                                        "200": {
                                            "description": "ok",
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "type": "object",
                                                        "required": ["ok"],
                                                        "properties": {
                                                            "ok": {"type": "boolean"}
                                                        },
                                                    }
                                                }
                                            },
                                        }
                                    }
                                }
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            policy = {
                **base_policy(upstream_origin),
                "operations": [{"method": "GET", "pathTemplate": "/health"}],
                "graphqlQueryOnly": False,
                "graphqlEndpointPath": None,
            }
            policy_path.write_text(json.dumps(policy), encoding="utf-8")
            command = [
                GATEWAY_PATH,
                "run",
                str(policy_path),
                "--",
                "run",
                str(schema_path),
                "--url",
                upstream_origin,
                "--workers",
                "1",
                "--max-examples",
                "1",
                "--max-failures",
                "1",
                "--rate-limit",
                "20/s",
                "--max-redirects",
                "0",
                "--request-timeout",
                "5",
                "--request-retries",
                "0",
                "--generation-deterministic",
                "--include-method",
                "GET",
                "--report",
                "ndjson",
                "--report-ndjson-path",
                str(output_path),
                "--output-sanitize",
                "true",
                "--output-truncate",
                "true",
            ]
            if AUTH_VALUE in json.dumps(command):
                raise AssertionError("auth_secret_leaked_to_argv")
            result = subprocess.run(command, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                raise AssertionError(
                    f"schemathesis_gateway_failed:{result.returncode}:"
                    f"{result.stdout[-1000:]}:{result.stderr[-1000:]}"
                )
            if not output_path.is_file():
                raise AssertionError("schemathesis_report_missing")
            if AUTH_VALUE in output_path.read_text(encoding="utf-8"):
                raise AssertionError("auth_secret_leaked_to_report")
        if not upstream_state.requests:
            raise AssertionError("schemathesis_request_missing")
        if any(row["method"] != "GET" for row in upstream_state.requests):
            raise AssertionError("unsafe_method_forwarded")
        if any(row["authorization"] != AUTH_VALUE for row in upstream_state.requests):
            raise AssertionError("trusted_auth_not_injected")
        return {"requestCount": len(upstream_state.requests), "authInjected": True}
    finally:
        stop_server(upstream, upstream_thread)


def request_body(
    port: int,
    body: bytes,
    path: str = "/graphql",
    content_type: str = "application/json",
) -> int:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(
            "POST",
            path,
            body=body,
            headers={
                "Content-Type": content_type,
                "Content-Length": str(len(body)),
                "Authorization": "Bearer scanner-controlled-value",
            },
        )
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def request_json(port: int, query: str) -> int:
    return request_body(port, json.dumps({"query": query}).encode("utf-8"))


def qualify_graphql_query_only(gateway) -> dict:
    upstream_state = UpstreamState()
    upstream, upstream_thread = start_server(upstream_handler(upstream_state))
    policy = {
        **base_policy(f"http://127.0.0.1:{upstream.server_port}"),
        "operations": [{"method": "POST", "pathTemplate": "/graphql"}],
        "graphqlQueryOnly": True,
        "graphqlEndpointPath": "/graphql",
    }
    gateway_server, gateway_thread = start_server(
        gateway.handler_for(gateway.GatewayState(policy))
    )
    try:
        query_status = request_json(gateway_server.server_port, "query { health }")
        forwarded_after_query = len(upstream_state.requests)
        mutation_status = request_json(
            gateway_server.server_port, "mutation { deleteEverything }"
        )
        duplicate_query_status = request_body(
            gateway_server.server_port,
            b'{"query":"mutation { deleteEverything }","query":"query { health }"}',
        )
        extensions_status = request_body(
            gateway_server.server_port,
            b'{"query":"query { health }","extensions":{"persistedQuery":{"sha256Hash":"canary"}}}',
        )
        method_override_status = request_body(
            gateway_server.server_port,
            b'{"query":"query { health }"}',
            "/graphql?_method=DELETE",
        )
        invalid_content_type_status = request_body(
            gateway_server.server_port,
            b'{"query":"query { health }"}',
            content_type="application/jsonattack",
        )
        if (
            query_status != 200
            or mutation_status != 400
            or duplicate_query_status != 400
            or extensions_status != 400
            or method_override_status != 400
            or invalid_content_type_status != 400
        ):
            raise AssertionError(
                "graphql_policy_status_invalid:"
                f"{query_status}:{mutation_status}:"
                f"{duplicate_query_status}:{extensions_status}:"
                f"{method_override_status}:{invalid_content_type_status}"
            )
        if forwarded_after_query != 1 or len(upstream_state.requests) != 1:
            raise AssertionError("graphql_mutation_forwarded")
        if upstream_state.requests[0]["authorization"] != AUTH_VALUE:
            raise AssertionError("graphql_trusted_auth_not_injected")
        return {
            "queryStatus": query_status,
            "mutationStatus": mutation_status,
            "duplicateQueryStatus": duplicate_query_status,
            "extensionsStatus": extensions_status,
            "methodOverrideStatus": method_override_status,
            "invalidContentTypeStatus": invalid_content_type_status,
        }
    finally:
        stop_server(gateway_server, gateway_thread)
        stop_server(upstream, upstream_thread)


def qualify_rest_request_parser(gateway) -> dict:
    upstream_state = UpstreamState()
    upstream, upstream_thread = start_server(upstream_handler(upstream_state))
    policy = {
        **base_policy(f"http://127.0.0.1:{upstream.server_port}"),
        "operations": [{"method": "GET", "pathTemplate": "/items/{id}"}],
        "graphqlQueryOnly": False,
        "graphqlEndpointPath": None,
    }
    gateway_server, gateway_thread = start_server(
        gateway.handler_for(gateway.GatewayState(policy))
    )
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1", gateway_server.server_port, timeout=5
        )
        connection.request("GET", "/items/%ZZ")
        invalid_percent_status = connection.getresponse().status
        connection.close()
        valid = http.client.HTTPConnection(
            "127.0.0.1", gateway_server.server_port, timeout=5
        )
        valid.request("GET", "/items/one")
        valid_status = valid.getresponse().status
        valid.close()
        if invalid_percent_status != 400 or valid_status != 200:
            raise AssertionError(
                f"rest_request_parser_status_invalid:{invalid_percent_status}:{valid_status}"
            )
        if len(upstream_state.requests) != 1:
            raise AssertionError("invalid_percent_path_forwarded")
        return {
            "invalidPercentStatus": invalid_percent_status,
            "validStatus": valid_status,
        }
    finally:
        stop_server(gateway_server, gateway_thread)
        stop_server(upstream, upstream_thread)


def main() -> None:
    gateway = load_gateway_module()
    result = {
        "ok": True,
        "policyFileBounds": qualify_policy_file_bounds(gateway),
        "realSchemathesis": qualify_real_schemathesis(),
        "graphqlQueryOnly": qualify_graphql_query_only(gateway),
        "restRequestParser": qualify_rest_request_parser(gateway),
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
