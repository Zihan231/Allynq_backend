import { Injectable } from '@nestjs/common';

export interface JobStatus {
  name: string;
  runs: number;
  failures: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastResult: string | null;
  /** Whether the most recent run succeeded (null before the first run). */
  lastOk: boolean | null;
}

export interface RequestError {
  at: string;
  method: string;
  path: string;
  status: number;
  message: string;
}

const MAX_ERRORS = 50;

/**
 * In-memory record of background jobs and failed requests, for the system health page.
 * It starts empty whenever the server restarts.
 */
@Injectable()
export class JobMonitorService {
  readonly startedAt = new Date();
  private readonly jobs = new Map<string, JobStatus>();
  private readonly errors: RequestError[] = [];
  private errorCount = 0;

  /** Runs a job and records how it went. Errors are recorded and re-thrown. */
  async run<T>(name: string, job: () => Promise<T>, describe?: (result: T) => string | null): Promise<T> {
    const status = this.jobs.get(name) ?? {
      name,
      runs: 0,
      failures: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      lastError: null,
      lastErrorAt: null,
      lastResult: null,
      lastOk: null,
    };
    this.jobs.set(name, status);
    const started = Date.now();
    status.lastStartedAt = new Date(started).toISOString();
    status.runs += 1;
    try {
      const result = await job();
      status.lastResult = describe ? describe(result) : null;
      status.lastOk = true;
      return result;
    } catch (error) {
      status.failures += 1;
      status.lastOk = false;
      status.lastError = (error as Error).message?.slice(0, 500) ?? String(error);
      status.lastErrorAt = new Date().toISOString();
      throw error;
    } finally {
      status.lastFinishedAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - started;
    }
  }

  recordError(error: Omit<RequestError, 'at'>): void {
    this.errorCount += 1;
    this.errors.unshift({ ...error, at: new Date().toISOString() });
    if (this.errors.length > MAX_ERRORS) this.errors.length = MAX_ERRORS;
  }

  snapshot() {
    return {
      startedAt: this.startedAt.toISOString(),
      jobs: [...this.jobs.values()].sort((a, b) => a.name.localeCompare(b.name)),
      errors: [...this.errors],
      errorCount: this.errorCount,
    };
  }
}
