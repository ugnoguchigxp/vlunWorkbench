export type WriteOperation<TDatabase, TResult> = (
	database: TDatabase,
) => TResult | Promise<TResult>;

export type DatabaseWriter<TDatabase> = {
	execute: <TResult>(
		operation: WriteOperation<TDatabase, TResult>,
	) => Promise<TResult>;
	close: () => Promise<void>;
};

export type ReadDatabase<TDatabase> = Omit<
	TDatabase,
	"delete" | "insert" | "run" | "transaction" | "update"
>;

export type DatabaseClient<TDatabase> = {
	/** 読み取り専用として扱うDB。書き込みは必ず write.execute() を使う。 */
	read: ReadDatabase<TDatabase>;
	/** このプロセスで唯一の書き込み入口。 */
	write: DatabaseWriter<TDatabase>;
};

/**
 * 1つの writable database を所有し、write operation をFIFOで直列化する。
 * writable database は operation の実行中だけ公開する。
 */
export function createSingleWriterClient<TDatabase>(
	database: TDatabase,
): DatabaseWriter<TDatabase> {
	let tail: Promise<void> = Promise.resolve();
	let closed = false;

	return {
		execute<TResult>(
			operation: WriteOperation<TDatabase, TResult>,
		): Promise<TResult> {
			if (closed) {
				return Promise.reject(new Error("Database writer is closed."));
			}

			const result = tail.then(() => operation(database));
			tail = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
		async close(): Promise<void> {
			closed = true;
			await tail;
		},
	};
}
