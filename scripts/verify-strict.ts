import { STRICT_VERIFY_COMMANDS } from "./verify-steps";

for (const command of STRICT_VERIFY_COMMANDS) {
	const child = Bun.spawn([...command], {
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	});
	const forwardSignal = (signal: NodeJS.Signals) => {
		child.kill(signal);
	};
	const onSigint = () => forwardSignal("SIGINT");
	const onSigterm = () => forwardSignal("SIGTERM");
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	const exitCode = await child.exited;
	process.off("SIGINT", onSigint);
	process.off("SIGTERM", onSigterm);
	if (exitCode !== 0) {
		process.exitCode = exitCode;
		break;
	}
}
