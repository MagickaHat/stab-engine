/**
 * @file pool.ts
 * @brief Spreads conversion jobs over CPU cores with worker threads.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { runJob } from './convert.ts';
import type { Job, JobResult } from './convert.ts';

/** @brief Jobs handed to a worker at a time. */
const BATCH = 48;

/**
 * @brief Convert every job, in parallel when it is worth it.
 * @param jobs Jobs to run.
 * @param threads Worker count; 0 picks one per CPU core.
 * @param onProgress Called with the number of finished jobs after each batch.
 * @return One result per job (in no particular order).
 */
export async function runJobs (jobs: Job[], threads = 0, onProgress: (done: number) => void = () => {}): Promise<JobResult[]>
{
    const count = Math.min(threads > 0 ? threads : os.availableParallelism(), Math.ceil(jobs.length / BATCH));
    const results: JobResult[] = [];
    if (count <= 1)
    {
        for (const job of jobs)
        {
            results.push(runJob(job));
            if (results.length % BATCH === 0) onProgress(results.length);
        }
        onProgress(results.length);
        return results;
    }

    let next = 0;
    await Promise.all(Array.from({ length: count }, () => new Promise<void>((resolve, reject) =>
    {
        const worker = new Worker(new URL('./worker.ts', import.meta.url));
        const send = () =>
        {
            if (next >= jobs.length)
            {
                void worker.terminate();
                resolve();
                return;
            }
            worker.postMessage(jobs.slice(next, next += BATCH));
        };
        worker.on('message', (batch: JobResult[]) =>
        {
            results.push(...batch);
            onProgress(results.length);
            send();
        });
        worker.on('error', reject);
        send();
    })));
    return results;
}
