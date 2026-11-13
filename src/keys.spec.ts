import { WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { isBip39Mnemonic, mnemonicToKeyPair } from './keys';

const TON_MNEMONIC =
  'ecology bread play relax reveal stay hobby tenant thunder fire hat movie brain alpha push never silly final blame narrow ivory boat orient merry';

// Expected keys come from @scure/bip39 seeds and SLIP-0010 on m/44'/607'/0', the way TON wallet apps import BIP39 phrases.
const BIP39_VECTORS = [
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    publicKey: '7952e94118f34607c75e23258dd9220d66ccac5a3ee074125c25068e8107bfbf',
    address: 'UQBHyu-oZVDHRYQ1-rKlGqpHy5yAqanPBirEQNMNOmfHLtaT',
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    publicKey: 'c6d2c947e552974c9f739fd7a02652519b8eef8cb9eef7867ac2e8f85777f244',
    address: 'UQC020bHeiUqqyw8BB4EttblmRidKkT_hnINJ-8rZCP0L1Dw',
  },
  {
    mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
    publicKey: '434908c4c092113fcced4eec061b09c02b7b8934a9ca555e2032505aab7558ea',
    address: 'UQBrw0MOZyO5dPbuh-iY3uGvZ63R9xc_0a7ddgwKUByq_UWB',
  },
];

const mainnetAddress = (publicKey: Buffer) =>
  WalletContractV5R1.create({
    workchain: 0,
    publicKey,
    walletId: { networkGlobalId: -239 },
  }).address.toString({ bounceable: false });

describe('mnemonicToKeyPair', () => {
  it('keeps the TON key derivation for a TON mnemonic', async () => {
    const keys = await mnemonicToKeyPair(TON_MNEMONIC);
    expect(keys).toEqual(await mnemonicToPrivateKey(TON_MNEMONIC.split(' ')));
  });

  it.each(BIP39_VECTORS)("derives a BIP39 phrase on m/44'/607'/0'", async vector => {
    const keys = await mnemonicToKeyPair(vector.mnemonic);
    expect(keys.publicKey.toString('hex')).toBe(vector.publicKey);
    expect(mainnetAddress(keys.publicKey)).toBe(vector.address);
  });

  it('ignores case and extra whitespace in a BIP39 phrase', async () => {
    const [vector] = BIP39_VECTORS;
    const keys = await mnemonicToKeyPair(
      `  ${vector.mnemonic.toUpperCase().replace(/ /g, '  ')}\n`,
    );
    expect(keys.publicKey.toString('hex')).toBe(vector.publicKey);
  });

  it('keeps the TON key derivation for a phrase that is neither TON nor BIP39', async () => {
    const phrase =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    const keys = await mnemonicToKeyPair(phrase);
    expect(keys).toEqual(await mnemonicToPrivateKey(phrase.split(' ')));
  });
});

describe('isBip39Mnemonic', () => {
  it.each(BIP39_VECTORS)('accepts a valid phrase', async vector => {
    expect(await isBip39Mnemonic(vector.mnemonic.split(' '))).toBe(true);
  });

  it('rejects a wrong checksum', async () => {
    expect(await isBip39Mnemonic(Array(12).fill('abandon'))).toBe(false);
  });

  it('rejects an unknown word', async () => {
    const words = BIP39_VECTORS[0].mnemonic.split(' ');
    words[0] = 'notaword';
    expect(await isBip39Mnemonic(words)).toBe(false);
  });

  it('rejects an unsupported word count', async () => {
    expect(await isBip39Mnemonic(BIP39_VECTORS[0].mnemonic.split(' ').slice(0, 11))).toBe(false);
  });
});
