import { createMessageSend } from '@evmos/transactions'
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet'
import { bank } from '../common/worker-const';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker';


export class BankWorker extends EvmosWorker {
  private readonly params: EvmosWorkerParams;
  constructor(params: EvmosWorkerParams) {
    super({
      account: params.account,
      waitForTxToMine: params.waitForTxToMine,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge,
      apiUrl: params.apiUrl,
      chainId: params.chainId,
      cosmosChainId: params.cosmosChainId,
      receiverAddress: params.receiverAddress
    });
    this.params = params;
    this.type = bank
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any) : Tx {
    const txSimple = createMessageSend(this.chainID, sender, LOCALNET_FEE, '', {
      destinationAddress: this.params.receiverAddress,
      amount: '1',
      denom: 'aevmos',
    })
    return txSimple
  }
}
