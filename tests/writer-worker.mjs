import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
const db = new Database(workerData.path, { timeout: 2000, fileMustExist: true });
db.pragma('foreign_keys=ON');
parentPort.postMessage('ready');
Atomics.wait(new Int32Array(workerData.signal), 0, 0, 5000);
try {
  db.exec('BEGIN IMMEDIATE');
  db.prepare(
    "INSERT INTO media_items(id,title,category_id,status,date_added) VALUES (?,?,'movie','planned','2026-10-15')",
  ).run(randomUUID(), 'Worker synthetic');
  db.exec('COMMIT');
  parentPort.postMessage('committed');
} catch (error) {
  if (db.inTransaction) db.exec('ROLLBACK');
  parentPort.postMessage(error.message);
} finally {
  db.close();
}
