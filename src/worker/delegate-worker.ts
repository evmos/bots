import { createTxMsgDelegate } from '@evmos/transactions'
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet'
import { delegate } from '../common/worker-const';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker';


export class DelegateWorker extends EvmosWorker {
  private readonly params: EvmosWorkerParams;
  constructor(params: EvmosWorkerParams, extra: any) {
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
    this.type = delegate;
    this.extraParams = extra;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any) : Tx {
    const txSimple = createTxMsgDelegate(this.chainID, sender, LOCALNET_FEE, '', {
      validatorAddress: this.params.receiverAddress,
      amount: '1',
      denom: 'aevmos',
    })
    return txSimple
  }
}
