import { LogLevel } from './common/logger.js';
import {
  booleanFromEnvOrDefault,
  logLevelFromEnvOrDefault,
  numberFromEnvOrDefault,
  stringFromEnvOrDefault,
  stringFromEnvOrThrow
} from './common/utils.js';

export interface BotConfig {
  rpcUrl: string;
  orchestratorAccountPrivateKey: string;
  numberOfWorkers: number;
  fundsPerAccount: string;
  waitForTxToMine: boolean;
  gasToConsumePerTx: string;
  logLevel: LogLevel;
  orchestratorMinFunds: string;
  serverPort: number;
  cosmosChainId: string;
  chainId: number;
  apiUrl: string;
}

export function getConfig(): BotConfig {
  return {
    cosmosChainId: stringFromEnvOrDefault('CHAIN_ID', 'evmos_9000-1'),
    chainId: numberFromEnvOrDefault('CHAIN_ID_NUMBER', 9000),
    rpcUrl: stringFromEnvOrDefault('RPC_URL', 'http://localhost:8545'),
    apiUrl: stringFromEnvOrDefault('API_URL', 'http://localhost:1317'),
    orchestratorAccountPrivateKey: stringFromEnvOrThrow('ORCH_PRIV_KEY'),
    orchestratorMinFunds: stringFromEnvOrDefault(
      'ORCH_MIN_FUNDS_BASE',
      '10000000000000000000'
    ),
    numberOfWorkers: numberFromEnvOrDefault('NUMBER_OF_WORKERS', 10),
    fundsPerAccount: stringFromEnvOrDefault(
      'FUNDS_PER_ACCOUNT_BASE',
      '1000000000000000000'
    ),
    waitForTxToMine: booleanFromEnvOrDefault('WAIT_FOR_TX_MINE', true),
    gasToConsumePerTx: stringFromEnvOrDefault('GAS_CONSUME_PER_TX', '100000'),
    logLevel: logLevelFromEnvOrDefault('LOG_LEVEL', 'info'),
    serverPort: numberFromEnvOrDefault('SERVER_PORT', 8080)
  };
}
