/**
 * @file worker.ts
 * @brief Worker-thread entry: converts batches of jobs sent by `pool.ts`.
 */
import { parentPort } from 'node:worker_threads';
import { runJob } from './convert.ts';
import type { Job } from './convert.ts';

parentPort!.on('message', (jobs: Job[]) =>
{
    parentPort!.postMessage(jobs.map(runJob));
});
