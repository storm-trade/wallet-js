import {
  Address,
  Cell,
  OpenedContract,
  parseTuple,
  serializeTuple,
  TonClient,
  TonClient4,
  TupleItem,
  TupleReader,
} from '@ton/ton';
import { LiteClient } from 'ton-lite-client';
import { Contract } from '@ton/core';
import { debugLog, isRateLimitError, timeout, withRetry } from './utils';

export type ContractState = {
  active: boolean;
  deployed: boolean;
};

export type RetryConfig = {
  maxRetries: number;
  delayMs: number;
};

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
};

function wrapContractWithRetry<T extends object>(contract: T, config: RetryConfig): T {
  return new Proxy(contract, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).catch(async (error: unknown) => {
            if (isRateLimitError(error)) {
              debugLog(`Rate limit (429) on contract call, retrying in ${config.delayMs}ms...`);
              await timeout(config.delayMs);
              return withRetry(
                () => value.apply(target, args) as Promise<unknown>,
                config.maxRetries - 1,
                config.delayMs,
              );
            }
            throw error;
          });
        }
        return result;
      };
    },
  });
}

export class TonClientAbstract {
  private retryConfig: RetryConfig;

  constructor(
    private readonly client: TonClient | TonClient4 | LiteClient,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  private retry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, this.retryConfig.maxRetries, this.retryConfig.delayMs);
  }

  public open<T extends Contract>(conract: T): OpenedContract<T> {
    const opened = this.client.open(conract);
    if (this.retryConfig.maxRetries === 0) return opened;
    return wrapContractWithRetry(opened, this.retryConfig);
  }

  public async isContractDeployed(address: Address): Promise<boolean> {
    return this.retry(async () => {
      if (this.client instanceof TonClient) {
        return this.client.isContractDeployed(address);
      } else if (this.client instanceof TonClient4) {
        const { last } = await this.client.getLastBlock();
        return this.client.isContractDeployed(last.seqno, address);
      } else {
        const master = await this.client.getMasterchainInfo();
        const accountState = await this.client.getAccountState(address, master.last);
        return accountState.state?.storage?.state.type === 'active';
      }
    });
  }

  public async getContractState(address: Address): Promise<ContractState> {
    return this.retry(async () => {
      if (this.client instanceof TonClient) {
        const state = await this.client.getContractState(address);
        return {
          deployed: state !== null,
          active: state.state === 'active',
        };
      } else if (this.client instanceof TonClient4) {
        const { last } = await this.client.getLastBlock();
        const { account } = await this.client.getAccountLite(last.seqno, address);
        return {
          deployed: account.state !== null,
          active: account.state.type === 'active',
        };
      } else {
        const master = await this.client.getMasterchainInfo();
        const accountState = await this.client.getAccountState(address, master.last);
        const state: ContractState = {
          deployed: accountState.state !== null,
          active: accountState.state?.storage?.state.type === 'active',
        };
        return state;
      }
    });
  }

  public async runGetMethod(
    address: Address,
    name: string,
    args: TupleItem[] = [],
  ): Promise<TupleReader> {
    return this.retry(async () => {
      if (this.client instanceof TonClient) {
        const { stack } = await this.client.runMethod(address, name, args);
        return stack;
      } else if (this.client instanceof TonClient4) {
        const { last } = await this.client.getLastBlock();
        const { reader } = await this.client.runMethod(last.seqno, address, name, args);
        return reader;
      } else {
        const { last } = await this.client.getMasterchainInfo();
        const { result } = await this.client.runMethod(
          address,
          name,
          serializeTuple(args).toBoc(),
          last,
        );
        if (!result) {
          return new TupleReader([]);
        }
        const resultTuple = parseTuple(Cell.fromBase64(result));
        return new TupleReader(resultTuple);
      }
    });
  }
}
