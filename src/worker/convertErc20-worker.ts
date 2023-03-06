import {
  createTxMsgConvertERC20,
  TxContext
} from '@evmos/evmosjs/packages/transactions/dist/index.js';
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet';
import { converter } from '../common/worker-const.js';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker.js';
import { Contract } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';
import { sleep } from '../common/tx.js';

export interface ERC20ConverterWorkerParams extends EvmosWorkerParams {
  contractAddress: string;
  deployer: NonceManager;
}

const CONTRACT_INTERFACES = [
  'function mint(address to, uint256 amount) public'
];

export class ConvertERC20Worker extends EvmosWorker {
  private readonly params: ERC20ConverterWorkerParams;
  private readonly contract: Contract;
  private readonly deployer: NonceManager;
  private amount: number;
  private ready: boolean;
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
    this.contract = new Contract(
      params.contractAddress,
      CONTRACT_INTERFACES,
      this.deployer
    );
    this.ready = false;

    this.amount = 1;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  async action(): Promise<void> {
    if (!this.ready) {
      this.contract.mint(this.wallet.address, '100000');
      await sleep(1000);
      this.ready = true;
    }
    await super.action();
  }

  createMessage(sender: any): Tx {
    const fee = LOCALNET_FEE;
    fee.gas = '2000000';
    fee.amount = '2000';
    const ctx: TxContext = {
      chain: this.chainID,
      sender,
      fee,
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
