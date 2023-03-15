import {
  createTxMsgConvertERC20,
  TxContext
} from 'evmosjs/packages/transactions/dist/index.js';
import { converter, defaultFees } from '../common/worker-const.js';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker.js';
import { Contract, providers } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';
import { refreshSignerNonce } from '../common/tx.js';
import { getExpectedNonce } from '../common/utils.js';

export interface ERC20ConverterWorkerParams extends EvmosWorkerParams {
  contractAddress: string;
  deployer: NonceManager;
}

const CONTRACT_INTERFACES = [
  'function mint(address to, uint256 amount) public'
];

export class ConvertERC20Worker extends EvmosWorker {
  private readonly params: ERC20ConverterWorkerParams;
  private readonly deployer: NonceManager;
  private amount: number;
  constructor(params: ERC20ConverterWorkerParams, extra: any) {
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
    this.type = converter;
    this.extraParams = extra;
    this.params.contractAddress = params.contractAddress;
    this.deployer = params.deployer;
    this.amount = 1;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  async action(): Promise<void> {
    let nonceSuggestion: number | undefined;
    let count = 0;
    while (count < this.retries) {
      try {
        const contract = new Contract(
          this.params.contractAddress,
          CONTRACT_INTERFACES,
          await refreshSignerNonce(
            this.deployer,
            'latest',
            this.logger,
            nonceSuggestion
          )
        );
        const res: providers.TransactionResponse = await contract.mint(
          this.wallet.address,
          '100000'
        );
        await res.wait(1);
        this.onSuccessfulTx(res);
        break;
      } catch (e) {
        const errStr = JSON.stringify(e);
        if (errStr.includes('nonce')) {
          // in case it is invalid nonce, retry with the refreshed signer
          this.logger.debug(
            'nonce error while minting ERC20. retrying with refreshed nonce'
          );
          nonceSuggestion = getExpectedNonce(errStr);
        } else {
          throw e;
        }
      }
      count++;
    }
    await super.action();
  }

  createMessage(sender: any): Tx {
    const ctx: TxContext = {
      chain: this.chainID,
      sender,
      fee: defaultFees,
      memo: ''
    };
    const txSimple = createTxMsgConvertERC20(ctx, {
      senderHex: this.wallet.address,
      receiverBech32: sender.accountAddress,
      amount: this.amount.toString(),
      contractAddress: this.params.contractAddress
    });
    this.amount += 1;
    return txSimple;
  }
}
