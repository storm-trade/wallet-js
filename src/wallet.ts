import {
  Address,
  beginCell,
  Cell,
  internal,
  JettonWallet,
  MessageRelaxed,
  OpenedContract,
  parseTuple,
  SendMode,
  serializeTuple,
  TupleBuilder,
  TupleReader,
  WalletContractV5R1,
} from '@ton/ton';
import { KeyPair, mnemonicToPrivateKey } from '@ton/crypto';
import { timeout, toAddress } from './utils';
import type { LiteClient } from 'ton-lite-client';

type ContractState = {
  active: boolean;
  deployed: boolean;
};

export type JettonConfig = {
  name: string;
  masterAddress: string | Address;
  decimals: number;
};

export const TRANSFER_FEE = 100000000n;

export class Wallet {
  private tonContract?: OpenedContract<WalletContractV5R1>;
  private tonContractState: ContractState = { active: false, deployed: false };
  private jettonContracts: Record<string, OpenedContract<JettonWallet>> = {};
  private jettonContractStates: Record<string, ContractState> = {};
  private jettonMasters: Record<string, Address> = {};
  private jettonDecimals: Record<string, number> = {};
  private keys?: KeyPair;

  constructor(
    private client: LiteClient,
    private mnemonic: string,
    public readonly name: string = '',
  ) {}

  async init(networkGlobalId?: number) {
    this.keys = await mnemonicToPrivateKey(this.mnemonic.split(' '));
    const tonWallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: this.keys.publicKey,
      walletId: {
        networkGlobalId,
      },
    });
    this.tonContract = this.client.open(tonWallet);
    this.tonContractState = await this.checkContractState(tonWallet.address);
  }

  private get _keys() {
    if (!this.keys) {
      throw new Error('Contract was not initialized');
    }
    return this.keys;
  }

  private get _tonContract() {
    if (!this.tonContract) {
      throw new Error('Contract was not initialized');
    }
    return this.tonContract;
  }

  private async waitContractDeploy(address: Address) {
    let state = undefined;
    while (state !== 'active') {
      const master = await this.client.getMasterchainInfo();
      const updatedAccountState = await this.client.getAccountState(address, master.last);
      state = updatedAccountState.state?.storage?.state.type;
    }
  }

  async deployContract() {
    const seqno = await this._tonContract.getSeqno();
    console.log(`Wallet ${this.name} deploying contract`);
    await this._tonContract.sendTransfer({
      seqno,
      secretKey: this._keys.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages: [
        internal({
          init: this._tonContract.init,
          bounce: false,
          to: this.getTonAddress(),
          value: TRANSFER_FEE,
        }),
      ],
    });
    await this.waitSeqno(seqno);
    await this.waitContractDeploy(this.getTonAddress());
    console.log(`Wallet ${this.name} contract deployed`);
  }

  async checkContractState(address: Address): Promise<ContractState> {
    const master = await this.client.getMasterchainInfo();
    const accountState = await this.client.getAccountState(address, master.last);
    const state: ContractState = {
      deployed: accountState.state !== null,
      active: accountState.state?.storage?.state.type === 'active',
    };
    return state;
  }

  private async parseJettonAddress(userAddress: Address, jettonMasterAddress: Address) {
    const userAddressCell = beginCell().storeAddress(userAddress).endCell();
    const master = await this.client.getMasterchainInfo();
    const params = new TupleBuilder();
    params.writeSlice(userAddressCell);
    const response = await this.client.runMethod(
      jettonMasterAddress,
      'get_wallet_address',
      serializeTuple(params.build()).toBoc(),
      master.last,
    );
    if (!response.result) {
      throw new Error('get_wallet_address returned no result');
    }

    const resultTuple = parseTuple(Cell.fromBoc(Buffer.from(response.result, 'base64'))[0]!);
    const parsed = new TupleReader(resultTuple);

    return parsed.readAddress();
  }

  async waitSeqno(seqno: number, checkInterval = 100) {
    let currentSeqno = seqno;
    while (currentSeqno === seqno) {
      await timeout(checkInterval);
      currentSeqno = await this._tonContract.getSeqno();
    }
    return currentSeqno;
  }

  private getJettonContract(name: string) {
    if (!this.jettonContracts[name]) {
      throw new Error(`Jetton contract ${name} not found`);
    }
    return this.jettonContracts[name];
  }

  private getJettonMaster(name: string) {
    if (!this.jettonMasters[name]) {
      throw new Error(`Jetton contract ${name} not found`);
    }
    return this.jettonMasters[name];
  }

  private async createJettonTransferMessage(master: Address, to: Address, amount: bigint) {
    const fromJetton = await this.parseJettonAddress(this._tonContract.address, master);

    const messageBody = beginCell()
      .storeUint(0x0f8a7ea5, 32) // opcode for jetton transfer
      .storeUint(0, 64) // query id
      .storeCoins(amount) // jetton amount, amount * 10^9
      .storeAddress(to)
      .storeAddress(to) // response destination
      .storeBit(0) // no custom payload
      .storeCoins(1n) // forward amount - if >0, will send notification message
      .storeBit(0) // we store forwardPayload as a reference
      .endCell();

    return internal({
      to: fromJetton,
      value: TRANSFER_FEE,
      bounce: true,
      body: messageBody,
    });
  }

  async addJetton(config: JettonConfig) {
    const { name, decimals, masterAddress: master } = config;
    const masterAddress = typeof master === 'string' ? Address.parse(master) : master;
    this.jettonMasters[name] = masterAddress;
    const jettonAddress = await this.parseJettonAddress(this._tonContract.address, masterAddress);
    const jettonWallet = JettonWallet.create(jettonAddress);
    this.jettonContracts[name] = this.client.open(jettonWallet);
    this.jettonContractStates[name] = await this.checkContractState(jettonWallet.address);
    this.jettonDecimals[name] = decimals;
  }

  getMnemonic() {
    return this.mnemonic;
  }

  async getTonBalance(): Promise<bigint> {
    if (!this.tonContractState.deployed) {
      return 0n;
    }
    return this._tonContract.getBalance();
  }

  async getJettonBalance(name: string): Promise<bigint> {
    if (!this.jettonContractStates[name]?.deployed) {
      return 0n;
    }
    const contract = this.getJettonContract(name);
    return contract.getBalance();
  }

  async getSeqno(): Promise<number> {
    return this._tonContract.getSeqno();
  }

  async createTransfer(messages: MessageRelaxed[], seqno: number) {
    return this._tonContract.createTransfer({
      seqno,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      secretKey: this._keys.secretKey,
      messages,
    });
  }

  private async tonTransfer(to: Address | string, amount: bigint): Promise<Buffer> {
    const seqno = await this._tonContract.getSeqno();
    const transfer = internal({
      bounce: false,
      to: toAddress(to),
      value: amount,
    });
    await this._tonContract.sendTransfer({
      seqno,
      secretKey: this._keys.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages: [transfer],
    });
    await this.waitSeqno(seqno);
    return transfer.body.hash();
  }

  private async jettonTransfer(
    jettonName: string,
    to: Address | string,
    amount: bigint,
  ): Promise<Buffer> {
    const jettonMaster = this.getJettonMaster(jettonName);
    const transfer = await this.createJettonTransferMessage(jettonMaster, toAddress(to), amount);
    const seqno = await this._tonContract.getSeqno();
    await this._tonContract.sendTransfer({
      seqno,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      secretKey: this._keys.secretKey,
      messages: [transfer],
    });
    await this.waitSeqno(seqno);
    return transfer.body.hash();
  }

  async getAllBalances(): Promise<Record<string, number>> {
    return Object.fromEntries(
      await Promise.all([
        this.getTonBalance().then(async result => ['TON', this.fromAsset('TON', result)] as const),
        ...Object.keys(this.jettonContracts).map(async name => {
          return [name, this.fromAsset(name, await this.getJettonBalance(name))];
        }),
      ]),
    );
  }

  getTonAddress(): Address {
    return this._tonContract.address;
  }

  getJettonAddress(assetName: string): Address {
    return this.getJettonContract(assetName).address;
  }

  async getBalance(assetName: string): Promise<number> {
    if (assetName === 'TON') {
      const balance = await this.getTonBalance();
      return this.fromAsset('TON', balance);
    }
    const balance = await this.getJettonBalance(assetName);
    return this.fromAsset(assetName, balance);
  }

  async send(messages: MessageRelaxed[]): Promise<void> {
    const seqno = await this._tonContract.getSeqno();
    await this._tonContract.sendTransfer({
      seqno,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      secretKey: this._keys.secretKey,
      messages,
    });
    await this.waitSeqno(seqno);
  }

  async createTransferMessageRaw(assetName: string, to: Address | string, amount: bigint) {
    if (assetName === 'TON') {
      return internal({
        bounce: false,
        to: toAddress(to),
        value: amount,
      });
    }
    const jettonMaster = this.getJettonMaster(assetName);
    return this.createJettonTransferMessage(jettonMaster, toAddress(to), amount);
  }

  async createTransferMessage(assetName: string, to: Address | string, amount: number) {
    const assetAmount = this.toAsset(assetName, amount);
    return this.createTransferMessageRaw(assetName, to, assetAmount);
  }

  async transferRaw(assetName: string, to: Address | string, amount: bigint): Promise<Buffer> {
    if (amount === 0n) {
      return Buffer.alloc(0);
    }
    if (assetName === 'TON') {
      return this.tonTransfer(to, amount);
    }
    return this.jettonTransfer(assetName, to, amount);
  }

  async transfer(assetName: string, to: Address | string, amount: number): Promise<Buffer> {
    const assetAmount = this.toAsset(assetName, amount);
    return this.transferRaw(assetName, to, assetAmount);
  }

  private toAsset(assetName: string, amount: number): bigint {
    if (assetName === 'TON') {
      return BigInt(Math.round(amount * 10 ** 9));
    }
    if (!this.jettonDecimals[assetName]) {
      throw new Error(`Jetton asset ${assetName} not found`);
    }
    return BigInt(Math.round(amount * 10 ** this.jettonDecimals[assetName]));
  }

  private fromAsset(assetName: string, amount: bigint): number {
    if (assetName === 'TON') {
      return Number(amount) / 10 ** 9;
    }
    if (!this.jettonDecimals[assetName]) {
      throw new Error(`Jetton asset ${assetName} not found`);
    }
    return Number(amount) / 10 ** this.jettonDecimals[assetName];
  }
}
