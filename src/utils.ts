import { Address } from '@ton/ton';

export const toAddress = (address: Address | string): Address => {
  return typeof address === 'string' ? Address.parse(address) : address;
};

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const debugLog = (...args: unknown[]) =>
  process.env.DEBUG_WALLET_JS ? console.log(...args) : undefined;
