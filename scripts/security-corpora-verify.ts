import path from "node:path";
import { verifyPreparedCorpora } from "./security-corpora-lib";

const outputRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
const verified = await verifyPreparedCorpora({ outputRoot });
console.log(
	JSON.stringify({
		ok: true,
		networkRequests: 0,
		outputRoot,
		corpora: verified,
	}),
);
