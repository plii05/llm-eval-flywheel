import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function sqlite(filename = ':memory:') {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec(readFileSync(new URL('../drizzle/0001_flywheel.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      const query = args => ({
        first: async () => statement.get(...args) ?? null,
        run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } })
      });
      return { ...query([]), bind: (...args) => query(args) };
    },
    close: () => database.close()
  };
}
