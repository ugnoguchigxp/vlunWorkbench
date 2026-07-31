import { describe, expect, it } from "bun:test";
import { parseGoModule } from "../../../api/plugins/builtin/go/modules";

describe("Go Modules dependency capability", () => {
	it("parses declared versions without executing the Go toolchain", () => {
		const parsed = parseGoModule([
			"module example.com/service",
			"go 1.24",
			"toolchain go1.24.1",
			"require (",
			"  golang.org/x/text v0.3.6",
			"  example.com/indirect v1.2.3 // indirect",
			")",
			"replace example.com/local => ../local",
			"require example.com/unparsed latest",
		].join("\n"));
		expect(parsed.modulePath).toBe("example.com/service");
		expect(parsed.requires).toEqual([
			{ module: "example.com/indirect", version: "v1.2.3", indirect: true },
			{ module: "golang.org/x/text", version: "v0.3.6", indirect: false },
		]);
		expect(parsed.limitationCodes).toEqual([
			"go_mod_replace_resolution_not_performed",
			"go_mod_require_unparsed",
			"go_toolchain_download_forbidden",
		]);
	});
});
