# Local runtime support boundary

vulnWorkbench 1.x supports one local application instance with one serialized
SQLite Writer. The supported capacity contract is the versioned policy in
`scripts/benchmark/local-runtime-policy.v1.json`; it measures health and
authenticated reads, Writer mutation concurrency, scan-process admission,
10,000-finding pagination, current Static Intelligence reads, and diagnostic
admission with a fixture LLM provider.

The benchmark must run at least three times. Release comparison uses the median
p50/p95/p99 and throughput, while retaining the worst queue depth and all
errors or rejections. Absolute policy limits always apply. A 20% p95 regression
and 25% RSS regression apply only when the recorded host class matches the
approved baseline, so a different CI machine is not presented as a like-for-like
comparison.

The following configurations are not supported by the 1.x runtime contract:

- multiple application instances writing the same SQLite database;
- a remote database or network filesystem used as the SQLite database path;
- a distributed rate limiter or distributed scan admission queue;
- a multi-node SQLite Writer;
- queue saturation, rejected Writer jobs, or timeouts treated as successful
  work.

Run the baseline with:

```bash
bun run benchmark:local-runtime -- --repeat=3
```

The result is written to `.artifacts/benchmark/local-runtime.json` and contains
only host class/toolchain metadata, fixture hashes, timings, queue/RSS values,
and error counts. It must not contain source bodies, credentials, or absolute
home paths. A real workload that exceeds this single-node capacity is evidence
for a separate architecture decision; it is not permission to silently widen
timeouts or weaken the policy.
