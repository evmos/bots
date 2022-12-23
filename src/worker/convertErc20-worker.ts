import { createTxMsgConvertERC20, createTxMsgSubmitProposal, Fee } from '@evmos/transactions'
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet'
import { converter } from '../common/worker-const';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker';
import { Contract } from 'ethers';
import { NonceManager } from '@ethersproject/experimental';

export interface ERC20ConverterWorkerParams extends EvmosWorkerParams {
  contractAddress: string;
  deployer :NonceManager;
}

const CONTRACT_INTERFACES = [
  'function mint(address to, uint256 amount) public'
];


export class ConvertERC20Worker extends EvmosWorker {
  private readonly params: ERC20ConverterWorkerParams;
  private readonly contract: Contract;
  private readonly deployer : NonceManager;
  constructor(params: ERC20ConverterWorkerParams, extra: any) {
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
    this.type = converter;
    this.extraParams = extra;
    this.params.contractAddress = params.contractAddress;
    this.deployer = params.deployer;
    this.contract = new Contract(
      params.contractAddress,
      CONTRACT_INTERFACES,
      this.deployer
    );

    this.contract.mint(this.wallet.address,'100000')
  }

  async onSuccessfulTx(receipt: any) {
    console.log(receipt)
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any) : Tx {
    let fee = LOCALNET_FEE;
    fee.gas = "2000000"
    fee.amount = "2000"
    const txSimple = createTxMsgConvertERC20(this.chainID, sender, fee, '', {
      senderHexFormatted:this.wallet.address,
      receiverEvmosFormatted: sender.accountAddress,
      amount: '1',
      contract_address: this.params.contractAddress,
    })
    return txSimple
  }
}
