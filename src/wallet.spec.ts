import { TonClient } from '@ton/ton';
import { Wallet } from './wallet';
import { TonClientAbstract } from './ton-client-abstract';

describe('wallet', () => {
  it('must respect 429 error', async () => {
    const client = new TonClient({
      endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    });
    const wallet = new Wallet(
      new TonClientAbstract(client),
      'ecology bread play relax reveal stay hobby tenant thunder fire hat movie brain alpha push never silly final blame narrow ivory boat orient merry',
    );
    await wallet.init(-3);
    let errorsCount = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const b = await wallet.getTonBalance();
        console.log(b);
      } catch (e) {
        if ((e as Error).message.includes('429')) {
          errorsCount++;
        }
      }
    }
    expect(errorsCount).toBe(0);
  });
});
