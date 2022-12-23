import { providers, Wallet } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { NonceManager } from '@ethersproject/experimental';
import { Logger } from '../common/logger';
import { sleep } from '../common/tx';

export interface Account {
  privateKey: string;
  address: string;
}

export interface IWorkerParams {
  waitForTxToMine: boolean;
  account: Account;
  provider: providers.Provider;
  successfulTxCounter: Counter<string>;
  failedTxCounter: Counter<string>;
  successfulTxFeeGauge: Gauge<string>;
  onInsufficientFunds: OnInsufficientFundsCallback;
  logger: Logger;
}

type OnInsufficientFundsCallback = () => Promise<void>;

export abstract class IWorker {
  private readonly waitForTxToMine: boolean;
  public readonly account: Account;
  private readonly successfulTxCounter: Counter<string>;
  private readonly failedTxCounter: Counter<string>;
  protected readonly successfulTxFeeGauge: Gauge<string>;
  protected readonly signer: NonceManager;
  protected isLowOnFunds = false;
  private readonly onInsufficientFunds: OnInsufficientFundsCallback;
  protected readonly logger: Logger;
  protected _isStopped = false;
  protected wallet: Wallet;
  public type :string;
  public extraParams : any;

  constructor(params: IWorkerParams) {
    this.waitForTxToMine = params.waitForTxToMine;
    this.account = params.account;
    this.wallet = new Wallet(params.account.privateKey, params.provider)
    this.signer = new NonceManager(
      this.wallet
    );
    this.successfulTxCounter = params.successfulTxCounter;
    this.failedTxCounter = params.failedTxCounter;
    this.successfulTxFeeGauge = params.successfulTxFeeGauge;
    this.onInsufficientFunds = params.onInsufficientFunds;
    this.logger = params.logger.child({
      workerAddr: params.account.address,
    });
    this.type = "invalid"
  }

  async run(): Promise<void> {
    console.log("Starting worker " + this.type)
    while (!this._isStopped) {
      if (!this.isLowOnFunds) {
        await this.action()
      } else {
        // delay to prevent loop from running synchronously
        await sleep(1000);
      }
    }
  }

  abstract action() : Promise<void>;
  abstract sendTransaction(): Promise<any>;

  stop() {
    console.log("Stopping worker " + this.type)
    this._isStopped = true;
  }

 async onSuccessfulTx(receipt: any) {
    this.successfulTxCounter.inc({
      worker: this.account.address
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onFailedTx(error: any) {
    try {
      let errorString = error.code;

      if (error.code == 'INSUFFICIENT_FUNDS') {
        this.logger.warn(`insufficient funds. need refunding`);
        this.isLowOnFunds = true;
        await this.onInsufficientFunds();
      } else if (error.code == 'SERVER_ERROR') {
        try {
          errorString = JSON.parse(error.body)['error']['message'];
          if (errorString.includes('nonce')) {
            errorString = 'INVALID_NONCE';
          }
          this._isStopped = true;
        } catch (e) {
          errorString = error.code;
        }
      }

      this.logger.error('new failed tx', {
        type: this.type,
        error: errorString
      });
      this.failedTxCounter.inc({
        worker: this.account.address,
        reason: errorString
      });
      await sleep(1000);
      // reset nonce in case it's a nonce issue
      this.signer.setTransactionCount(await this.signer.getTransactionCount("pending"));
    } catch (err) {
      this.logger.error('error processing failed tx. Code error!', {
        error: error
      });
    }
  }

  async hasBeenRefunded() {
    this.isLowOnFunds = false;
  }
}
