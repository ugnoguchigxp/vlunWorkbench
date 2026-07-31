import { describe, expect, it } from "bun:test";
import { extractEndpoints } from "./endpoint-extractors";

describe("Spring endpoint plugin", () => {
	it("combines class and method mappings", () => {
		const endpoints = extractEndpoints({
			path: "src/main/java/example/OrderController.java",
			content: `
@RestController
@RequestMapping("/api/orders")
public class OrderController {
  @GetMapping("/{id}")
  Order get() { return null; }

  @RequestMapping(path = "/{id}/refund", method = RequestMethod.POST)
  void refund() {}
}`,
		});

		expect(
			endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
		).toEqual(["GET /api/orders/{id}", "POST /api/orders/{id}/refund"]);
		expect(endpoints.every((endpoint) => endpoint.framework === "spring-mvc")).toBe(
			true,
		);
	});

	it("does not invent an HTTP method for methodless RequestMapping", () => {
		const endpoints = extractEndpoints({
			path: "Controller.java",
			content: `
class Controller {
  @RequestMapping("/ambiguous")
  void ambiguous() {}
}`,
		});
		expect(endpoints).toEqual([]);
	});

	it("requires the Spring plugin when active plugins are supplied", () => {
		const source = {
			path: "src/HealthController.java",
			content: `
@RestController
class HealthController {
  @GetMapping("/health")
  String health() { return "ok"; }
}`,
		};

		expect(
			extractEndpoints(source, {
				activePluginIds: ["language.java", "build.gradle"],
			}),
		).toEqual([]);
		expect(
			extractEndpoints(source, {
				activePluginIds: [
					"language.java",
					"build.gradle",
					"framework.java.spring",
				],
			}),
		).toHaveLength(1);
	});
});
