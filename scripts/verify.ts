type VerifyStep = {
  label: string;
  command: string[];
};

const steps: VerifyStep[] = [
  { label: "typecheck", command: ["bun", "run", "typecheck"] },
  { label: "lint", command: ["bun", "run", "lint"] },
  { label: "format", command: ["bun", "run", "format:check"] },
  { label: "test", command: ["bun", "run", "test"] },
  { label: "build", command: ["bun", "run", "build"] },
];

const decoder = new TextDecoder();

for (const step of steps) {
  const proc = Bun.spawn(step.command, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    console.log(`OK ${step.label}`);
    continue;
  }

  console.error(`FAIL ${step.label}`);
  console.error(`$ ${step.command.join(" ")}`);

  const stdoutText = decoder.decode(stdout);
  const stderrText = decoder.decode(stderr);
  if (stdoutText.length > 0) console.error(stdoutText.trimEnd());
  if (stderrText.length > 0) console.error(stderrText.trimEnd());

  process.exit(exitCode);
}

console.log("OK verify complete");
