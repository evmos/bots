import { providers, Wallet } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { NonceManager } from '@ethersproject/experimental';
import { Logger } from '../common/logger';
import { sleep } from '../common/tx';
import { Logger as etherLogger } from 'ethers/lib/utils';
import { useTryAsync } from 'no-try';

export interface Account {
  privateKey: string;
  address: string;
}

export interface IWorkerParams {
  account: Account;
  provider: providers.Provider;
  successfulTxCounter: Counter<string>;
  failedTxCounter: Counter<string>;
  successfulTxFeeGauge: Gauge<string>;
  onInsufficientFunds: OnInsufficientFundsCallback;
  logger: Logger;
}

type OnInsufficientFundsCallback = () => void;

export abstract class IWorker {
  public readonly account: Account;
  private readonly successfulTxCounter: Counter<string>;
  private readonly failedTxCounter: Counter<string>;
  protected readonly successfulTxFeeGauge: Gauge<string>;
  protected readonly signer: NonceManager;
  private readonly onInsufficientFunds: OnInsufficientFundsCallback;
  protected readonly logger: Logger;
  protected _isLowOnFunds = false;
  protected _isStopped = false;
  protected wallet: Wallet;
  public type: string;
  public extraParams: any;

  constructor(params: IWorkerParams) {
    this.account = params.account;
    this.wallet = new Wallet(params.account.privateKey, params.provider);
    this.signer = new NonceManager(this.wallet);
    this.successfulTxCounter = params.successfulTxCounter;
    this.failedTxCounter = params.failedTxCounter;
    this.successfulTxFeeGauge = params.successfulTxFeeGauge;
    this.onInsufficientFunds = params.onInsufficientFunds;
    this.logger = params.logger.child({
      workerAddr: params.account.address
    });
    this.type = 'invalid';
  }

  abstract sendTransaction(): Promise<providers.TransactionResponse>;

  onSuccessfulTx(receipt: providers.TransactionReceipt) {
    this.successfulTxCounter.inc({
      worker: this.account.address
    });
  }

  hasBeenRefunded() {
    this._isLowOnFunds = false;
  }

  stop() {
    this._isStopped = true;
  }

  async run(): Promise<void> {
    while (!this._isStopped) {
      if (!this._isLowOnFunds) {
        const [err, txResponse] = await useTryAsync(() =>
          this.sendTransaction()
        );
        if (err) {
          this.onFailedTx(err);
          continue;
        }
        // not awaiting here because we want to handle successful TX async
        txResponse
          .wait()
          .then((txReceipt: providers.TransactionReceipt) => {
            this.onSuccessfulTx(txReceipt);
          })
          .catch((err: any) => {
            this.logger.error(err);
          });
      } else {
        // delay to prevent loop from running synchronously
        await sleep(1000);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onFailedTx(error: any) {
    if (error == undefined) {
      error = { code: -1 };
    }
    // handle recovery for every case
    switch (error.code) {
      case etherLogger.errors.INSUFFICIENT_FUNDS:
        this.logger.warn('insufficient funds. need refunding');
        this._isLowOnFunds = true;
        this.onInsufficientFunds();
        break;
      case etherLogger.errors.NONCE_EXPIRED:
        this.logger.error(etherLogger.errors.NONCE_EXPIRED);
        this.refreshSignerNonce('latest');
        break;
      case etherLogger.errors.SERVER_ERROR:
        // eslint-disable-next-line no-case-declarations
        const errorMessage = JSON.parse(error.body)['error']['message'];
        this.logger.error(etherLogger.errors.SERVER_ERROR, {
          error: errorMessage
        });
        // for some reason our nonce expired cases are not being categorized
        // by ethers library as so
        if (errorMessage.includes('nonce')) {
          this.refreshSignerNonce('latest');
        } else if (errorMessage.includes('tx already in mempool')) {
          this.refreshSignerNonce('pending');
        }
        break;
      default:
        this.logger.error(`code: ${error.code}`, {
          error
        });
        break;
    }
    this.failedTxCounter.inc({
      worker: this.account.address,
      reason: error.code
    });
  }

  async refreshSignerNonce(blockTag: 'latest' | 'pending') {
    const [err, txCount] = await useTryAsync(() =>
      this.signer.getTransactionCount(blockTag)
    );
    if (err) {
      this.logger.error('failed to get account nonce', {
        error: err
      });
    } else {
      this.signer.setTransactionCount(txCount);
    }
  }
}
