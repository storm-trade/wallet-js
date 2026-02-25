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

export type ContractState = {
  active: boolean;
  deployed: boolean;
};

export class TonClientAbstract {
  constructor(private readonly client: TonClient | TonClient4 | LiteClient) {}

  public open<T extends Contract>(conract: T): OpenedContract<T> {
    return this.client.open(conract);
  }

  public async isContractDeployed(address: Address): Promise<boolean> {
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
  }

  public async getContractState(address: Address): Promise<ContractState> {
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
  }

  public async runGetMethod(
    address: Address,
    name: string,
    args: TupleItem[] = [],
  ): Promise<TupleReader> {
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
  }
}
