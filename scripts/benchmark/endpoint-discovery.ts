import { mkdir } from "node:fs/promises";
import path from "node:path";
import { extractEndpoints } from "../../api/modules/threat-models/endpoint-extractors";

const fixtures = [
	{
		path: "hono.ts",
		content: 'import { Hono } from "hono"; app.get("/hono/:id", handler);',
		expected: ["GET /hono/{id}"],
	},
	{
		path: "express.js",
		content: 'const express = require("express"); router.post("/express", h);',
		expected: ["POST /express"],
	},
	{
		path: "fastify.ts",
		content:
			'import fastify from "fastify"; app.route({ method: "PUT", url: "/fastify/:id", handler });',
		expected: ["PUT /fastify/{id}"],
	},
	{
		path: "fastapi.py",
		content:
			'from fastapi import FastAPI\n@app.patch("/fastapi/{id}")\ndef h(): pass',
		expected: ["PATCH /fastapi/{id}"],
	},
	{
		path: "flask.py",
		content: 'from flask import Flask\n@app.route("/flask")\ndef h(): pass',
		expected: ["GET /flask"],
	},
	{
		path: "django.py",
		content:
			'from django.urls import path\nfrom django.views.decorators.http import require_http_methods\n@require_http_methods(["DELETE"])\ndef remove(request): pass\nurlpatterns = [path("django/<int:id>", remove)]',
		expected: ["DELETE /django/{id}"],
	},
	{
		path: "Spring.java",
		content: '@GetMapping("/spring/{id}") public void get() {}',
		expected: ["GET /spring/{id}"],
	},
	{
		path: "Jax.java",
		content: '@Path("/jax/{id}")\n@POST\npublic void post() {}',
		expected: ["POST /jax/{id}"],
	},
	{
		path: "nethttp.go",
		content:
			'package main\nfunc main(){ http.HandleFunc("/net/{id}", func(w http.ResponseWriter, r *http.Request) { if r.Method != "DELETE" { return } }) }',
		expected: ["DELETE /net/{id}"],
	},
	{
		path: "gin.go",
		content:
			'package main\nimport "github.com/gin-gonic/gin"\nfunc r(e *gin.Engine){ e.GET("/gin/:id", h) }',
		expected: ["GET /gin/{id}"],
	},
	{
		path: "echo.go",
		content:
			'package main\nimport "github.com/labstack/echo/v4"\nfunc r(e *echo.Echo){ e.POST("/echo/:id", h) }',
		expected: ["POST /echo/{id}"],
	},
	{
		path: "negative.ts",
		content:
			'const api = { get: (value: string) => value }; const text = api.get("not-a-route");',
		expected: [],
	},
];
const expected = new Set(fixtures.flatMap((fixture) => fixture.expected));
const actual = new Set(
	fixtures.flatMap((fixture) =>
		extractEndpoints(fixture).map((item) => `${item.method} ${item.path}`),
	),
);
const truePositive = [...actual].filter((item) => expected.has(item)).length;
const falsePositive = [...actual].filter((item) => !expected.has(item)).length;
const falseNegative = [...expected].filter((item) => !actual.has(item)).length;
const recall = truePositive / (truePositive + falseNegative);
const precision = truePositive / (truePositive + falsePositive);
const outputPath = path.resolve(
	".artifacts/benchmark/endpoint-discovery-metrics.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			frameworkCount: 11,
			truePositive,
			falsePositive,
			falseNegative,
			recall,
			precision,
			expected: [...expected].sort(),
			actual: [...actual].sort(),
		},
		null,
		2,
	)}\n`,
);
console.log(
	JSON.stringify({
		ok: recall >= 0.9 && precision >= 0.9,
		outputPath,
		recall,
		precision,
	}),
);
if (recall < 0.9 || precision < 0.9) process.exitCode = 1;
