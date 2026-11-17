/**
 * @file convert.ts
 * @brief Converts one source file into one output file. Runs in worker threads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeBmp } from './bmp.ts';
import { transform } from './image.ts';
import type { ImageNote, ImageOp } from './image.ts';
import { decodePng, encodePng } from './png.ts';

/** @brief One file to produce. */
export interface Job
{
    /** Absolute source path. */
    src: string;
    /** Absolute output path. */
    dest: string;
    /** Resize instructions for images (`.png`, `.bmp`; written as PNG); `null` copies the file byte for byte. */
    image: ImageOp | null;
}

/** @brief What happened to one job. */
export interface JobResult
{
    dest: string;
    /** Output image size (missing for copied files). */
    size?: [number, number];
    notes: ImageNote[];
    /** Set if the file could not be converted; nothing was written. */
    error?: string;
}

/**
 * @brief Run one job: read, resize if asked, write.
 * @param job The job.
 * @return Its result. Never throws.
 */
export function runJob (job: Job): JobResult
{
    try
    {
        fs.mkdirSync(path.dirname(job.dest), { recursive: true });
        if (!job.image)
        {
            fs.copyFileSync(job.src, job.dest);
            return { dest: job.dest, notes: [] };
        }
        const bytes = fs.readFileSync(job.src);
        const decoded = path.extname(job.src).toLowerCase() === '.bmp' ? decodeBmp(bytes) : decodePng(bytes);
        const { image, notes } = transform(decoded, job.image);
        fs.writeFileSync(job.dest, encodePng(image));
        return { dest: job.dest, size: [image.width, image.height], notes };
    }
    catch (error)
    {
        return { dest: job.dest, notes: [], error: error instanceof Error ? error.message : String(error) };
    }
}
