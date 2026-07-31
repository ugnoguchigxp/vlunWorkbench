import { mkdir } from "node:fs/promises";
import path from "node:path";
import { extractEndpoints } from "../../api/modules/threat-models/endpoint-extractors";

const fixtures = [
	{
		path: "hono.ts",
		content: 'import { Hono } from "hono"; app.get("/hono/:id", handler);',
		expected: ["GET /hono/{id}"],
		activePluginIds: ["framework.typescript.hono"],
	},
	{
		path: "express.js",
		content: 'const express = require("express"); router.post("/express", h);',
		expected: ["POST /express"],
		activePluginIds: ["framework.typescript.express"],
	},
	{
		path: "fastify.ts",
		content:
			'import fastify from "fastify"; app.route({ method: "PUT", url: "/fastify/:id", handler });',
		expected: ["PUT /fastify/{id}"],
		activePluginIds: ["framework.typescript.fastify"],
	},
	{
		path: "fastapi.py",
		content:
			'from fastapi import FastAPI\n@app.patch("/fastapi/{id}")\ndef h(): pass',
		expected: ["PATCH /fastapi/{id}"],
		activePluginIds: ["framework.python.fastapi"],
	},
	{
		path: "flask.py",
		content: 'from flask import Flask\n@app.route("/flask")\ndef h(): pass',
		expected: ["GET /flask"],
		activePluginIds: ["framework.python.flask"],
	},
	{
		path: "django.py",
		content:
			'from django.urls import path\nfrom django.views.decorators.http import require_http_methods\n@require_http_methods(["DELETE"])\ndef remove(request): pass\nurlpatterns = [path("django/<int:id>", remove)]',
		expected: ["DELETE /django/{id}"],
		activePluginIds: ["framework.python.django"],
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
			'package main\nimport "net/http"\nfunc main(){ http.HandleFunc("/net/{id}", func(w http.ResponseWriter, r *http.Request) { if r.Method != "DELETE" { return } }) }',
		expected: ["DELETE /net/{id}"],
		activePluginIds: ["framework.go.net-http"],
	},
	{
		path: "gin.go",
		content:
			'package main\nimport "github.com/gin-gonic/gin"\nfunc r(e *gin.Engine){ e.GET("/gin/:id", h) }',
		expected: ["GET /gin/{id}"],
		activePluginIds: ["framework.go.gin"],
	},
	{
		path: "echo.go",
		content:
			'package main\nimport "github.com/labstack/echo/v4"\nfunc r(e *echo.Echo){ e.POST("/echo/:id", h) }',
		expected: ["POST /echo/{id}"],
		activePluginIds: ["framework.go.echo"],
	},
	{
		path: "negative.ts",
		content:
			'const api = { get: (value: string) => value }; const text = api.get("not-a-route");',
		expected: [],
		activePluginIds: [],
	},
	{
		path: "negative.py",
		content:
			'from fastapi import FastAPI\ntext = "@app.get(\\"/not-a-route\\")"\n# @app.post("/commented")',
		expected: [],
		activePluginIds: ["framework.python.fastapi"],
	},
	{
		path: "negative.go",
		content:
			'package main\ntype Router struct{}\nfunc route(r Router) { r.GET("/not-a-route", handler) }',
		expected: [],
		activePluginIds: ["framework.go.gin"],
	},
];
const expected = new Set(fixtures.flatMap((fixture) => fixture.expected));
const observations = fixtures.map((fixture) => {
	const actual = new Set(
		extractEndpoints(fixture, {
			...(fixture.activePluginIds
				? { activePluginIds: fixture.activePluginIds }
				: {}),
		}).map((item) => `${item.method} ${item.path}`),
	);
	const expectedForFixture = new Set(fixture.expected);
	return {
		path: fixture.path,
		expected: [...expectedForFixture].sort(),
		actual: [...actual].sort(),
		truePositive: [...actual].filter((item) => expectedForFixture.has(item))
			.length,
		falsePositive: [...actual].filter((item) => !expectedForFixture.has(item))
			.length,
		falseNegative: [...expectedForFixture].filter((item) => !actual.has(item))
			.length,
	};
});
const actual = new Set(
	observations.flatMap((observation) => observation.actual),
);
const truePositive = observations.reduce(
	(total, observation) => total + observation.truePositive,
	0,
);
const falsePositive = observations.reduce(
	(total, observation) => total + observation.falsePositive,
	0,
);
const falseNegative = observations.reduce(
	(total, observation) => total + observation.falseNegative,
	0,
);
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
			observations,
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
