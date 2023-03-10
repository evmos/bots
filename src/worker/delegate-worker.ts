import {
  createTxMsgDelegate,
  TxContext
} from 'evmosjs/packages/transactions/dist/index.js';
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet';
import { randomInt } from 'crypto';
import { delegate } from '../common/worker-const.js';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker.js';

export class DelegateWorker extends EvmosWorker {
  private readonly params: EvmosWorkerParams;
  private validatorsCount: number;
  constructor(params: EvmosWorkerParams, extra: any) {
    super({
      account: params.account,
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
    this.validatorsCount = params.receiverAddress.length;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any): Tx {
    const ctx: TxContext = {
      chain: this.chainID,
      sender,
      fee: LOCALNET_FEE,
      memo: ''
    };
    // randomnly delegate to available validators
    const validatorAddress =
      this.params.receiverAddress[randomInt(this.validatorsCount)];
    const txSimple = createTxMsgDelegate(ctx, {
      validatorAddress,
      amount: '1',
      denom: 'aevmos'
    });
    return txSimple;
  }
}
