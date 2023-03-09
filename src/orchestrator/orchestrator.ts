import { BigNumber, ContractFactory, providers, Wallet } from 'ethers';
import {
  broadcastTxWithRetry,
  getNativeCoinBalance,
  refreshSignerNonce,
  sendNativeCoin,
  signTransaction,
  sleep
} from '../common/tx.js';
import { GasConsumerWorker } from '../worker/gas-consumer-worker.js';
import { IWorker } from '../worker/iworker.js';
import fs from 'fs';
import path from 'path';
import { NonceManager } from '@ethersproject/experimental';
import { Counter, Gauge } from 'prom-client';
import { Logger } from '../common/logger.js';
import { BankWorker } from '../worker/bank-worker.js';
import { DelegateWorker } from '../worker/delegate-worker.js';
import { ConvertERC20Worker } from '../worker/convertErc20-worker.js';
import { EthSenderWorker } from '../worker/eth-sender-worker.js';
import {
  bank,
  converter,
  delegate,
  ethSender,
  gasConsumer,
  workersToSpan
} from '../common/worker-const.js';
import {
  createTxMsgSubmitProposal,
  MsgSubmitProposalParams,
  createTxMsgVote,
  MsgVoteParams,
  TxContext
} from '@evmos/evmosjs/packages/transactions/dist/index.js';
import { getSender, LOCALNET_FEE } from '@hanchon/evmos-ts-wallet';
import { createMsgRegisterERC20 } from '@evmos/evmosjs/packages/proto/dist/index.js';
import { getValidatorsAddresses } from '../client/index.js';
import { getExpectedNonce } from '../common/utils.js';

export interface OrchestratorParams {
  orchestratorAccountPrivKey: string;
  numberOfWorkers: number;
  fundAllocationPerAccountBASE: string;
  minFundsOrchestrator: string;
  rpcUrl: string;
  waitForTxMine: boolean;
  gasToConsumePerTx: string;
  logger: Logger;
  chainId: number;
  cosmosChainId: string;
  apiUrl: string;
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
  private wallet: Wallet;
  private checkBalanceInterval?: NodeJS.Timer;
  private readonly contracts: Contracts = {};
  private isInitiliazing = true;
  private toFundQueue: IWorker[] = [];
  private isStopped = false;
  private readonly logger: Logger;
  private validators: string[] = [];
  private readonly retries = 10;
  private readonly backoff = 2000; // retry backoff in millisecs

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
    this.provider = new providers.JsonRpcProvider({
      url: params.rpcUrl,
      timeout: 5_000 // 5s
    });
    this.wallet = new Wallet(params.orchestratorAccountPrivKey, this.provider);
    this.signer = new NonceManager(this.wallet);
    this.logger = params.logger;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onFailedTx(error: any) {
    this.signer.setTransactionCount(await this.signer.getTransactionCount());
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
    this.validators = await getValidatorsAddresses(this.params.apiUrl);
    await this._throwIfOrchestratorBalanceBelowThreshold();
    await this._initializeContracts();
    await this._initializeWorkers();
    this._startWorkers();
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
    this.logger.info(`initializing ${this.params.numberOfWorkers} workers`);
    const typesCount = workersToSpan.length;
    for (let i = 0; i < this.params.numberOfWorkers; i++) {
      const workerType = workersToSpan[i % typesCount];
      await this.addWorker(workerType, {});
    }
  }

  async addWorker(type: string, params: any) {
    const workerWallet = Wallet.createRandom();

    // fund account
    await this._fundAccount(workerWallet.address, true);
    let worker: IWorker;
    let valid = true;
    switch (type) {
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

    if (!valid) {
      return;
    }

    // add worker to internal list
    this.logger.info(`created ${type} worker @ ${workerWallet.address}`);
    this.workers.push(worker);
  }

  _startWorkers() {
    this.logger.info('starting workers');
    for (const worker of this.workers) {
      this.logger.debug(`start worker @ ${worker.account.address}`);
      worker.run();
    }
  }

  killWorker(type: string) {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.workers[i].type == type) {
        this.workers[i].stop();
        return;
      }
    }
  }

  async _initializeContracts() {
    this.logger.info('initializing contracts');
    await this._deployGasConsumerContract();
    await this._deployERC20();
  }

  async _initializeRefunder() {
    this.logger.info('initializing refunder');
    while (!this.isStopped) {
      if (!this.isInitiliazing && this.toFundQueue.length > 0) {
        while (this.toFundQueue.length > 0) {
          const worker = this.toFundQueue.shift();
          this.logger.debug(`refunding account ${worker?.account.address}`);
          if (worker) {
            await this._fundAccount(worker.account.address, true);
            worker.hasBeenRefunded();
          }
        }
      }
      // sleep to prevent loop from running synchronously
      await sleep(3000);
    }
  }

  async _fundAccount(
    address: string,
    waitForTxMine?: boolean
  ): Promise<boolean> {
    this.logger.info(`funding ${address}`);
    // retry when failing due to invalid nonce
    let count = 0;
    let err: Error | undefined;
    let nonceSuggestion: number | undefined;
    while (count < this.retries) {
      try {
        await this._throwIfOrchestratorBalanceBelowThreshold();
        await sendNativeCoin(
          await refreshSignerNonce(
            this.signer,
            'latest',
            this.logger,
            nonceSuggestion
          ),
          address,
          this.params.fundAllocationPerAccountBASE,
          waitForTxMine == undefined ? this.params.waitForTxMine : waitForTxMine
        );
        return true;
      } catch (e: any) {
        err = e;
        const errStr = JSON.stringify(e);
        if (errStr.includes('nonce')) {
          // in case it is invalid nonce, retry with the refreshed signer
          this.logger.debug(
            'nonce error while funding account. retrying with refreshed nonce'
          );
          nonceSuggestion = getExpectedNonce(errStr);
        } else {
          break;
        }
      }
      count++;
      // wait a little before retry
      await sleep(this.backoff);
    }

    this.onFailedTx(err);
    this.logger.error('error funding address ', address);
    return false;
  }

  async _deployERC20(): Promise<string> {
    this.contracts.erc20Contract = await this._deployContract(
      './contracts/ERC20MinterBurnerDecimals.json',
      ['test', 'test', 18],
      'erc20'
    );
    await this.registerPair(this.contracts.erc20Contract);
    return this.contracts.erc20Contract;
  }

  async registerPair(erc20Contract: string): Promise<boolean> {
    const registerErc20 = createMsgRegisterERC20(
      'Register test',
      'Register test',
      [erc20Contract]
    );

    const sender = await getSender(this.wallet, this.params.apiUrl);
    const proposal: MsgSubmitProposalParams = {
      content: registerErc20,
      denom: 'aevmos',
      amount: '20000000000000000',
      proposer: sender.accountAddress
    };
    const chain = {
      chainId: this.params.chainId,
      cosmosChainId: this.params.cosmosChainId
    };

    const fee = LOCALNET_FEE;
    fee.gas = '2000000';
    fee.amount = '2000';

    const ctx: TxContext = {
      chain,
      sender,
      fee,
      memo: ''
    };

    this.logger.info('registering ERC20...');

    const sendProposal = createTxMsgSubmitProposal(ctx, proposal);
    const signed = await signTransaction(this.wallet, sendProposal);
    const res = await broadcastTxWithRetry(
      signed,
      this.params.apiUrl,
      this.retries,
      this.logger
    );

    if (
      (res.code && res.code !== 0) ||
      (res.tx_response && res.tx_response.code !== 0)
    ) {
      this.logger.error(
        `could not register pair after ${this.retries} retries: code ${
          res.code || res.tx_response.code
        }, message: ${res.message || res.tx_response.raw_log}`
      );
      return false;
    }

    // wait 3s for tx to be processed
    await sleep(3000);
    this.signer.setTransactionCount(await this.signer.getTransactionCount());

    // get updated sender (with updated sequence) and use it on tx context
    ctx.sender = await getSender(this.wallet, this.params.apiUrl);

    const pos = res.tx_response.raw_log.indexOf('proposal_id');
    const endPos = res.tx_response.raw_log.indexOf('"}', pos);
    const proposal_id: number = res.tx_response.raw_log.substring(
      pos + 22,
      endPos
    );
    this.logger.info(`created RegisterERC20Proposal with id ${proposal_id}`);

    const vote: MsgVoteParams = {
      proposalId: proposal_id,
      option: 1
    };

    this.logger.info('voting');
    const voteProposal = createTxMsgVote(ctx, vote);

    const signedVote = await signTransaction(this.wallet, voteProposal);
    await broadcastTxWithRetry(
      signedVote,
      this.params.apiUrl,
      this.retries,
      this.logger
    );
    this.signer.setTransactionCount(await this.signer.getTransactionCount());

    // no need to wait if number of workers is > 5
    // setting up the workers covers the time for the proposal to pass
    if (this.params.numberOfWorkers < 5) {
      this.logger.info('sleeping... wait proposal to pass');
      await sleep(45000);
      this.logger.info('awaken');
    }
    return true;
  }

  async _deployGasConsumerContract(): Promise<string> {
    this.contracts.gasConsumerContract = await this._deployContract(
      './contracts/GasConsumer.json',
      [],
      'gas consumer'
    );
    return this.contracts.gasConsumerContract;
  }

  async _deployContract(
    contractPath: string,
    args: any[],
    contractType?: string
  ): Promise<string> {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), contractPath)).toString()
    );

    // retry in case of invalid nonce
    let count = 0;
    let err: Error | undefined;
    let nonceSuggestion: number | undefined;
    while (count < this.retries) {
      const factory = new ContractFactory(
        metadata.abi,
        metadata.bytecode,
        await refreshSignerNonce(
          this.signer,
          'latest',
          this.logger,
          nonceSuggestion
        )
      );

      try {
        const contract = await factory.deploy(...args);
        await contract.deployTransaction.wait(1);
        this.logger.info(`${contractType} contract deployed`, {
          address: contract.address
        });
        return contract.address;
      } catch (e: any) {
        err = e;
        const errStr = JSON.stringify(e);
        if (errStr.includes('nonce')) {
          // in case it is invalid nonce, retry with the refreshed signer
          this.logger.debug(
            `nonce error while deploying ${contractType} contract. retrying with refreshed nonce`
          );
          nonceSuggestion = getExpectedNonce(errStr);
        } else {
          break;
        }
      }
      count++;
      // wait a little before retry
      await sleep(this.backoff);
    }
    this.logger.error('error deploying contract. Exiting!', {
      error: err
    });
    throw err;
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

  createBankWorker(workerWallet: Wallet, params: any): IWorker {
    if (!('receiver' in params)) {
      params['receiver'] = 'evmos1pmk2r32ssqwps42y3c9d4clqlca403yd9wymgr';
    }
    const worker = new BankWorker(
      {
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
        receiverAddress: params['receiver']
      },
      params
    );
    return worker;
  }

  createEthSenderWorker(workerWallet: Wallet, params: any): IWorker {
    if (!('receiver' in params)) {
      params['receiver'] = '0x0Eeca1c550801c1855448E0adAE3e0FE3b57c48D';
    }
    const worker = new EthSenderWorker({
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
      receiverAddress: params['receiver']
    });
    return worker;
  }

  async createGasConsumerWorker(
    workerWallet: Wallet,
    _: any
  ): Promise<IWorker> {
    const worker = new GasConsumerWorker({
      account: {
        privateKey: workerWallet.privateKey,
        address: workerWallet.address
      },
      provider: this.provider,
      contractAddress:
        this.contracts.gasConsumerContract ||
        (await this._deployGasConsumerContract()),
      gasToConsumePerTX: this.params.gasToConsumePerTx,
      successfulTxCounter: this.successfulTxCounter,
      failedTxCounter: this.failedTxCounter,
      onInsufficientFunds: async () => {
        this.toFundQueue.push(worker);
      },
      successfulTxFeeGauge: this.successfulTxFeeGauge,
      logger: this.logger
    });
    return worker;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createDelegateWorker(workerWallet: Wallet, params: any): [IWorker, boolean] {
    let valid = true;
    // cant delegate to a default value, since validators change
    if (!('validator' in params)) {
      if (this.validators && this.validators.length) {
        params['validator'] = this.validators[0];
      } else {
        valid = false;
      }
    }
    const worker = new DelegateWorker(
      {
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
      },
      params
    );
    return [worker, valid];
  }

  async createErc20ConverterWorker(
    workerWallet: Wallet,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraParams: any
  ): Promise<IWorker> {
    const worker = new ConvertERC20Worker(
      {
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
        receiverAddress: '',
        deployer: this.signer
      },
      extraParams
    );
    return worker;
  }
}
