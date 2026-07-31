import { describe, expect, it } from "bun:test";
import { extractEndpoints } from "./endpoint-extractors";

describe("Python and Go endpoint plugins", () => {
	it("uses only an active Python framework contribution and applies router prefixes", () => {
		const source = {
			path: "api.py",
			content: [
				"from fastapi import APIRouter",
				'router = APIRouter(prefix="/v1")',
				'# @router.delete("/commented")',
				'fake = "@router.post(\\"/string\\")"',
				'@router.get("/items/{item_id}")',
				"def item(item_id: str): pass",
			].join("\n"),
		};
		expect(
			extractEndpoints(source, { activePluginIds: ["framework.python.fastapi"] }).map(
				(endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.framework}`,
			),
		).toEqual(["GET /v1/items/{item_id} fastapi"]);
		expect(
			extractEndpoints(source, { activePluginIds: ["framework.python.flask"] }),
		).toEqual([]);
	});

	it("keeps FastAPI and Flask receiver evidence separate in a mixed file", () => {
		const source = {
			path: "mixed.py",
			content: [
				"from fastapi import APIRouter",
				"from flask import Blueprint",
				'api = APIRouter(prefix="/api")',
				'admin = Blueprint("admin", __name__, url_prefix="/admin")',
				'@api.get("/items")',
				"def items(): pass",
				'@admin.get("/users")',
				"def users(): pass",
			].join("\n"),
		};

		expect(
			extractEndpoints(source, {
				activePluginIds: ["framework.python.fastapi"],
			}).map((endpoint) => `${endpoint.method} ${endpoint.path}`),
		).toEqual(["GET /api/items"]);
		expect(
			extractEndpoints(source, {
				activePluginIds: ["framework.python.flask"],
			}).map((endpoint) => `${endpoint.method} ${endpoint.path}`),
		).toEqual(["GET /admin/users"]);
	});

	it("tracks aliased Gin receivers and group prefixes without matching unrelated routers", () => {
		const source = {
			path: "routes.go",
			content: [
				"package routes",
				'import g "github.com/gin-gonic/gin"',
				"func Register(r *g.Engine) {",
				'  v1 := r.Group("/v1")',
				'  v1.POST("/items/:id", handler)',
				'  // v1.DELETE("/commented")',
				"  other.GET(\"/unrelated\", handler)",
				"}",
			].join("\n"),
		};
		expect(
			extractEndpoints(source, { activePluginIds: ["framework.go.gin"] }).map(
				(endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.framework}`,
			),
		).toEqual(["POST /v1/items/{id} gin"]);
	});

	it("extracts net/http routes only with exact import and known ServeMux receivers", () => {
		const source = {
			path: "main.go",
			content: [
				"package main",
				"/*",
				'import "net/http"',
				"*/",
				'import web "net/http"',
				"func main() {",
				"  mux := web.NewServeMux()",
				'  mux.HandleFunc("GET /health", health)',
				"}",
			].join("\n"),
		};
		expect(
			extractEndpoints(source, { activePluginIds: ["framework.go.net-http"] }).map(
				(endpoint) => `${endpoint.method} ${endpoint.path}`,
			),
		).toEqual(["GET /health"]);
	});
});
