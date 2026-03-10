import { Address } from '@ton/ton';

export const toAddress = (address: Address | string): Address => {
  return typeof address === 'string' ? Address.parse(address) : address;
};

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const debugLog = (...args: unknown[]) =>
  process.env.DEBUG_WALLET_JS ? console.log(...args) : undefined;

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.message.includes('429') || error.message.toLowerCase().includes('too many requests')) {
      return true;
    }
  }
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (
      err.status === 429 ||
      (err.response as Record<string, unknown> | undefined)?.status === 429 ||
      err.statusCode === 429
    ) {
      return true;
    }
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error) && attempt < maxRetries) {
        debugLog(`Rate limit (429), retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
        await timeout(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
