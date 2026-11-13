import {
  deriveEd25519Path,
  KeyPair,
  keyPairFromSeed,
  mnemonicToPrivateKey,
  mnemonicValidate,
  mnemonicWordList,
  pbkdf2_sha512,
  sha256,
} from '@ton/crypto';

/** Path TON wallet apps (Tonkeeper, Ledger) derive the first account of a BIP39 phrase on: m/44'/607'/0'. */
export const BIP39_TON_DERIVATION_PATH = [44, 607, 0];

/** Word counts a BIP39 phrase may have. */
const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Derives the wallet key pair from a mnemonic.
 *
 * A TON mnemonic goes through the TON key derivation. A phrase that is not a TON mnemonic
 * but is a valid BIP39 one is derived the way TON wallet apps import it: BIP39 seed,
 * then SLIP-0010 ed25519 on m/44'/607'/0'. Any other phrase keeps the TON key derivation.
 */
export async function mnemonicToKeyPair(mnemonic: string): Promise<KeyPair> {
  // The split stays as in earlier versions, so every phrase that is not BIP39 keeps its key.
  const words = mnemonic.split(' ');
  if (await mnemonicValidate(words)) {
    return mnemonicToPrivateKey(words);
  }
  const bip39Words = mnemonic.normalize('NFKD').trim().toLowerCase().split(/\s+/);
  if (await isBip39Mnemonic(bip39Words)) {
    return bip39MnemonicToKeyPair(bip39Words);
  }
  return mnemonicToPrivateKey(words);
}

/**
 * Whether the words form a BIP39 phrase over the English wordlist with a matching checksum.
 */
export async function isBip39Mnemonic(words: string[]): Promise<boolean> {
  if (!BIP39_WORD_COUNTS.includes(words.length)) {
    return false;
  }
  const indexes = words.map(word => mnemonicWordList.indexOf(word));
  if (indexes.some(index => index < 0)) {
    return false;
  }
  const bits = indexes.map(index => index.toString(2).padStart(11, '0')).join('');
  const checksumLength = words.length / 3;
  const entropyBits = bits.slice(0, bits.length - checksumLength);
  const entropy = Buffer.from(entropyBits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const hashBits = [...(await sha256(entropy))]
    .map(byte => byte.toString(2).padStart(8, '0'))
    .join('');
  return hashBits.slice(0, checksumLength) === bits.slice(bits.length - checksumLength);
}

/**
 * Derives the key pair of the first TON account of a BIP39 phrase.
 */
async function bip39MnemonicToKeyPair(words: string[]): Promise<KeyPair> {
  const seed = await pbkdf2_sha512(words.join(' '), 'mnemonic', 2048, 64);
  return keyPairFromSeed(await deriveEd25519Path(seed, BIP39_TON_DERIVATION_PATH));
}
