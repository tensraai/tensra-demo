/** Demo-friendly backoff. Production would use longer delays plus jitter. */
export const DEFAULT_DELAYS_MS = [1000, 2000, 4000];

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Only server-side / rate-limit failures are worth retrying. Validation errors (4xx) are not. */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && (status >= 500 || status === 429);
}

export class RetryFailure extends Error {
  constructor(
    public original: unknown,
    public retries: number,
    public retryable: boolean,
  ) {
    super("retry failure");
  }
}

export interface AttemptInfo {
  /** 0 = first request, 1 = first retry, ... */
  attempt: number;
  error: unknown;
  retryable: boolean;
  willRetry: boolean;
  nextDelayMs?: number;
}

export interface RetryOptions {
  delaysMs: number[]; // one entry per allowed retry
  sleep: (ms: number) => Promise<void>;
  isRetryable: (err: unknown) => boolean;
  onAttemptFailed?: (info: AttemptInfo) => void;
}

/** Runs fn; retries retryable failures with the given delays. Throws RetryFailure when giving up. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<{ value: T; retries: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: await fn(), retries: attempt };
    } catch (error) {
      const retryable = opts.isRetryable(error);
      const willRetry = retryable && attempt < opts.delaysMs.length;
      const nextDelayMs = willRetry ? opts.delaysMs[attempt] : undefined;
      opts.onAttemptFailed?.({ attempt, error, retryable, willRetry, nextDelayMs });
      if (!willRetry) throw new RetryFailure(error, attempt, retryable);
      await opts.sleep(nextDelayMs!);
    }
  }
}
