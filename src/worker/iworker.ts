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
  private readonly successfulTxFeeGauge: Gauge<string>;
  protected readonly signer: NonceManager;
  private readonly onInsufficientFunds: OnInsufficientFundsCallback;
  private readonly logger: Logger;
  protected _isLowOnFunds = false;
  protected _isStopped = false;

  constructor(params: IWorkerParams) {
    this.account = params.account;
    this.signer = new NonceManager(
      new Wallet(params.account.privateKey, params.provider)
    );
    this.successfulTxCounter = params.successfulTxCounter;
    this.failedTxCounter = params.failedTxCounter;
    this.successfulTxFeeGauge = params.successfulTxFeeGauge;
    this.onInsufficientFunds = params.onInsufficientFunds;
    this.logger = params.logger.child({
      workerAddr: params.account.address
    });
  }

  abstract sendTransaction(): Promise<providers.TransactionResponse>;

  onSuccessfulTx(receipt: providers.TransactionReceipt) {
    this.logger.debug('new successful tx', {
      hash: receipt.transactionHash,
      block: receipt.blockNumber,
      index: receipt.transactionIndex
    });
    this.successfulTxCounter.inc({
      worker: this.account.address
    });
    this.successfulTxFeeGauge.set(
      {
        worker: this.account.address
      },
      receipt.gasUsed.toNumber()
    );
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
          await this.onFailedTx(err);
          continue;
        }
        // not awaiting here because we want to handle succesful TX async
        txResponse
          .wait()
          .then((txReceipt: providers.TransactionReceipt) => {
            this.onSuccessfulTx(txReceipt);
          })
          .catch((err) => {
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
    this.failedTxCounter.inc({
      worker: this.account.address,
      reason: error.code
    });
    await this.handleFailedTxRecovery(error);
  }

  // handle recovery for every error case
  async handleFailedTxRecovery(error: any) {
    switch (error.code) {
      case etherLogger.errors.INSUFFICIENT_FUNDS:
        this.logger.warn('insufficient funds. need refunding');
        this._isLowOnFunds = true;
        this.onInsufficientFunds();
        break;
      case etherLogger.errors.NONCE_EXPIRED:
        this.logger.error(etherLogger.errors.NONCE_EXPIRED);
        await this.refreshSignerNonce('latest');
        break;
      case etherLogger.errors.SERVER_ERROR:
        const errorMessage = JSON.parse(error.body)['error']['message'];
        this.logger.error(etherLogger.errors.SERVER_ERROR, {
          error: errorMessage
        });
        // for some reason our nonce expired cases are not being categorized
        // by ethers library as so
        if (errorMessage.includes('nonce')) {
          await this.refreshSignerNonce('latest');
        } else if (errorMessage.includes('tx already in mempool')) {
          await this.refreshSignerNonce('pending');
        }
        break;
      default:
        this.logger.error(`code: ${error.code}`, {
          error
        });
        break;
    }
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
