import { BigNumber, ContractFactory, providers, Signer, Wallet } from 'ethers';
import { getNativeCoinBalance, sendNativeCoin, sleep } from '../common/tx';
import { GasConsumerWorker } from '../worker/gas-consumer-worker';
import { IWorker } from '../worker/iworker';
import fs from 'fs';
import path from 'path';
import { NonceManager } from '@ethersproject/experimental';
import { Counter, Gauge } from 'prom-client';
import { Logger } from '../common/logger';
import { BankWorker } from '../worker/bank-worker';
import { DelegateWorker } from '../worker/delegate-worker';
import { ConvertERC20Worker } from '../worker/convertErc20-worker';
import { EthSenderWorker } from '../worker/eth-sender-worker';
import { bank, converter, delegate, ethSender, gasConsumer } from '../common/worker-const';
import { Worker } from 'cluster';
import { kill } from 'process';
import { exec } from 'child_process';

export interface OrchestratorParams {
  orchestratorAccountPrivKey: string;
  numberOfWorkers: number;
  fundAllocationPerAccountBASE: string;
  minFundsOrchestrator: string;
  rpcUrl: string;
  waitForTxMine: boolean;
  gasToConsumePerTx: string;
  logger: Logger;
  chainId : number;
  cosmosChainId: string;
  apiUrl : string;
}

export interface Contracts {
  gasConsumerContract?: string;
  erc20Contract?: string;
}



export class Orchestrator {
  private readonly params: OrchestratorParams;
  private workers: IWorker[] = [];
  private provider: providers.Provider;
  private readonly signer: NonceManager;
  private checkBalanceInterval?: NodeJS.Timer;
  private readonly contracts: Contracts = {};
  private isInitiliazing = true;
  private toFundQueue: IWorker[] = [];
  private isStopped = false;
  private readonly logger: Logger;
  private readonly successfulTxCounter = new Counter({
    name: 'num_success_tx',
    help: 'counter for number of successful txs',
    labelNames: ['worker']
  });
  private readonly failedTxCounter = new Counter({
    name: 'num_failed_tx',
    help: 'counter for number of failed txs',
    labelNames: ['worker', 'reason']
  });
  private readonly successfulTxFeeGauge = new Gauge({
    name: 'fee_success_tx',
    help: 'fee for successful tx',
    labelNames: ['worker']
  });

  constructor(params: OrchestratorParams) {
    this.params = params;
    this.provider = new providers.JsonRpcProvider(params.rpcUrl);
    this.signer = new NonceManager(
      new Wallet(params.orchestratorAccountPrivKey, this.provider)
    );
    this.logger = params.logger;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onFailedTx(error: any) {
    try {
      let errorString = error.code;

      if (error.code == 'INSUFFICIENT_FUNDS') {
        this.logger.warn(`insufficient funds. need refunding`);
      } else if (error.code == 'SERVER_ERROR') {
        try {
          errorString = JSON.parse(error.body)['error']['message'];
          if (errorString.includes('nonce')) {
            errorString = 'INVALID_NONCE';
          }
        } catch (e) {
          errorString = error.code;
        }
      }

      this.logger.error('new failed tx', {
        error: errorString
      });
      this.failedTxCounter.inc({
        worker: 'orchestrator',
        reason: errorString
      });
      // reset nonce in case it's a nonce issue
      this.signer.setTransactionCount(await this.signer.getTransactionCount());
    } catch (err) {
      this.logger.error('error processing failed tx. Code error!', {
        error: error
      });
    }
  }

  async initialize() {
    this.isInitiliazing = true;
    this.logger.info('initializing orchestrator');
    await this._throwIfOrchestratorBalanceBelowThreshold();
    await this._initializeContracts();
    await this._initializeWorkers();
    this._initializeRefunder();
    this.isInitiliazing = false;
    return this;
  }

  async stop() {
    this.workers.map((worker) => worker.stop());
    if (this.checkBalanceInterval) clearInterval(this.checkBalanceInterval);
    this.isStopped = true;
    this.logger.info('stopped the orchestrator');
  }

  async _initializeWorkers() {
    this.logger.info('initializing workers');
    for (let i = 0; i < this.params.numberOfWorkers; i++) {
      await this.addWorker(ethSender, {})
    }
  }

  async addWorker(type : string, params: any) {
    const workerWallet = Wallet.createRandom();

    // fund account
    await this._fundAccount(workerWallet.address, true);
    let worker : IWorker;
    let valid = true;
    switch(type) {
      case bank:
        worker = this.createBankWorker(workerWallet, params);
        break;
      case delegate:
        [worker, valid] = this.createDelegateWorker(workerWallet, params);
        break;
      case gasConsumer:
        worker = await this.createGasConsumerWorker(workerWallet, params);
        break;
      case converter:
        worker = await this.createErc20ConverterWorker(workerWallet, params);
        break;
      case ethSender:
        worker = this.createEthSenderWorker(workerWallet, params);
        break;
      default:
        worker = this.createBankWorker(workerWallet, params);
        break;
    }

    if (!valid){
      return;
    }

    // start worker
    worker.run();

    // add worker to internal list
    this.workers.push(worker);
  }

  killWorker(type : string) {
    for (let i=0; i < this.workers.length; i++ ){
      if (this.workers[i].type == type)
      {
        this.workers[i].stop();
        return;
      }
    }
  }

  async _initializeContracts() {
    this.logger.info('initializing contracts');
    await this._deployGasConsumerContract();
    await this._deployERC20();
    this.contracts.erc20Contract =  "0xafc2751f9aEcA24816C0027F69C64d12A457F6B9";
  }

  async _initializeRefunder() {
    this.logger.info('initializing refunder');
    while (!this.isStopped) {
      if (!this.isInitiliazing && this.toFundQueue.length > 0) {
        while (this.toFundQueue.length > 0) {
          const worker = this.toFundQueue.shift();
          if (worker) {
            await this._fundAccount(worker.account.address, true);
            worker.hasBeenRefunded();
          }
        }
      } else {
        // sleep to prevent loop from running synchronously
        await sleep(1000);
      }
    }
  }

  async _fundAccount(
    address: string,
    waitForTxMine?: boolean
  ): Promise<boolean> {
    this.logger.info(`funding ${address}`);
    try {
      await this._throwIfOrchestratorBalanceBelowThreshold();
      await sendNativeCoin(
        this.signer,
        address,
        this.params.fundAllocationPerAccountBASE,
        waitForTxMine == undefined ? this.params.waitForTxMine : waitForTxMine
      );
      return true;
    } catch (e) {
      this.onFailedTx(e);
      this.logger.error('error funding address ', address);
      return false;
    }
  }



  async _deployERC20(): Promise<string> {
    const metadata = JSON.parse(
      fs
        .readFileSync(path.join(process.cwd(), './contracts/ERC20MinterBurnerDecimals.json'))
        .toString()
    );
    const factory = new ContractFactory(
      metadata.abi,
      metadata.bytecode,
      this.signer
    );

    try {
      const contract = await factory.deploy("test","test", 18);
      await contract.deployTransaction.wait(1);
      this.logger.info('erc20 contract deployed', {
        address: contract.address
      });
      this.contracts.erc20Contract = contract.address;
      return contract.address;
    } catch (e) {
      this.logger.error('error deploying contract. Exiting!', {
        error: e
      });
      throw e;
    }


  }

  async _deployGasConsumerContract(): Promise<string> {
    const metadata = JSON.parse(
      fs
        .readFileSync(path.join(process.cwd(), './contracts/GasConsumer.json'))
        .toString()
    );
    const factory = new ContractFactory(
      metadata.abi,
      metadata.bytecode,
      this.signer
    );

    try {
      const contract = await factory.deploy();
      await contract.deployTransaction.wait(1);
      this.logger.info('gas consumer contract deployed', {
        address: contract.address
      });
      this.contracts.gasConsumerContract = contract.address;
      return contract.address;
    } catch (e) {
      this.logger.error('error deploying contract. Exiting!', {
        error: e
      });
      throw e;
    }
  }

  async _throwIfOrchestratorBalanceBelowThreshold(): Promise<void> {
    const orchestratorBalance = await getNativeCoinBalance(
      this.provider,
      await this.signer.getAddress()
    );
    this.logger.info('orchestrator balance', {
      balance: orchestratorBalance.toString()
    });
    if (
      orchestratorBalance.lt(BigNumber.from(this.params.minFundsOrchestrator))
    ) {
      throw new Error('Insufficient funds in orchestrator account');
    }
  }

  createBankWorker(workerWallet: Wallet, params : any) : IWorker {
    if (!('receiver' in params)) {
      params['receiver'] = "evmos1pmk2r32ssqwps42y3c9d4clqlca403yd9wymgr"
    }
    const worker =  new BankWorker({
        waitForTxToMine: this.params.waitForTxMine,
        account: {
          privateKey: workerWallet.privateKey,
          address: workerWallet.address
        },
        provider: this.provider,
        successfulTxCounter: this.successfulTxCounter,
        failedTxCounter: this.failedTxCounter,
        onInsufficientFunds: async () => {
          this.toFundQueue.push(worker);
        },
        successfulTxFeeGauge: this.successfulTxFeeGauge,
        logger: this.logger,
        apiUrl: this.params.apiUrl,
        chainId: this.params.chainId,
        cosmosChainId: this.params.cosmosChainId,
        receiverAddress:  params['receiver']
      }, params);
      return worker
  }

  createEthSenderWorker(workerWallet: Wallet, params : any) : IWorker {
    if (!('receiver' in params)) {
      params['receiver'] = "0x0Eeca1c550801c1855448E0adAE3e0FE3b57c48D"
    }
    const worker =  new EthSenderWorker({
        waitForTxToMine: this.params.waitForTxMine,
        account: {
          privateKey: workerWallet.privateKey,
          address: workerWallet.address
        },
        provider: this.provider,
        successfulTxCounter: this.successfulTxCounter,
        failedTxCounter: this.failedTxCounter,
        onInsufficientFunds: async () => {
          this.toFundQueue.push(worker);
        },
        successfulTxFeeGauge: this.successfulTxFeeGauge,
        logger: this.logger,
        receiverAddress:  params['receiver']
      });
      return worker
  }

  async createGasConsumerWorker(workerWallet : Wallet, _ : any) : Promise<IWorker> {
    const worker = new GasConsumerWorker({
      waitForTxToMine: this.params.waitForTxMine,
      account: {
        privateKey: workerWallet.privateKey,
        address: workerWallet.address
      },
      provider: this.provider,
      contractAddress: this.contracts.gasConsumerContract
        ? this.contracts.gasConsumerContract
        : await this._deployGasConsumerContract(),
      gasToConsumePerTX: this.params.gasToConsumePerTx,
      successfulTxCounter: this.successfulTxCounter,
      failedTxCounter: this.failedTxCounter,
      onInsufficientFunds: async () => {
        this.toFundQueue.push(worker);
      },
      successfulTxFeeGauge: this.successfulTxFeeGauge,
      logger: this.logger,
    });
    return worker;
  }

createDelegateWorker(workerWallet: Wallet, params : any) : [IWorker, boolean] {
    let valid = true;
    // cant delegate to a default value, since validators change
    if (!('validator' in params)){
      valid = false
    }
    const worker =  new DelegateWorker({
        waitForTxToMine: this.params.waitForTxMine,
        account: {
          privateKey: workerWallet.privateKey,
          address: workerWallet.address
        },
        provider: this.provider,
        successfulTxCounter: this.successfulTxCounter,
        failedTxCounter: this.failedTxCounter,
        onInsufficientFunds: async () => {
          this.toFundQueue.push(worker);
        },
        successfulTxFeeGauge: this.successfulTxFeeGauge,
        logger: this.logger,
        apiUrl: this.params.apiUrl,
        chainId: this.params.chainId,
        cosmosChainId: this.params.cosmosChainId,
        receiverAddress: params['validator']
      }, params);
      return [worker, valid]
  }

  async createErc20ConverterWorker(workerWallet : Wallet, extraParams : any) : Promise<IWorker> {
    const worker = new ConvertERC20Worker({
      waitForTxToMine: this.params.waitForTxMine,
      account: {
        privateKey: workerWallet.privateKey,
        address: workerWallet.address
      },
      provider: this.provider,
      contractAddress: this.contracts.erc20Contract
        ? this.contracts.erc20Contract
        : await this._deployERC20(),
      successfulTxCounter: this.successfulTxCounter,
      failedTxCounter: this.failedTxCounter,
      onInsufficientFunds: async () => {
        this.toFundQueue.push(worker);
      },
      successfulTxFeeGauge: this.successfulTxFeeGauge,
      logger: this.logger,
      apiUrl: this.params.apiUrl,
      chainId: this.params.chainId,
      cosmosChainId: this.params.cosmosChainId,
      receiverAddress: "",
      deployer: this.signer
    }, extraParams);
    return worker;
  }
}
