import { LogLevel } from './common/logger';
import {
  booleanFromEnvOrDefault,
  logLevelFromEnvOrDefault,
  numberFromEnvOrDefault,
  stringFromEnvOrDefault,
  stringFromEnvOrThrow
} from './common/utils';

export interface BotConfig {
  rpcUrl: string;
  orchestratorAccountPrivateKey: string;
  numberOfAccounts: number;
  fundsPerAccount: string;
  waitForTxToMine: boolean;
  gasToConsumePerTx: string;
  logLevel: LogLevel;
  orchestratorMinFunds: string;
  serverPort: number;
  cosmosChainId: string;
  chainId : number;
  apiUrl : string;
  
}

export function getConfig(): BotConfig {
  return {
    cosmosChainId : stringFromEnvOrDefault('CHAIN_ID', 'evmos_9000-1'),
    chainId : numberFromEnvOrDefault('CHAIN_ID_NUMBER', 9000),
    rpcUrl: stringFromEnvOrThrow('RPC_URL'),
    apiUrl: stringFromEnvOrThrow('API_URL'),
    orchestratorAccountPrivateKey: stringFromEnvOrThrow('ORCH_PRIV_KEY'),
    orchestratorMinFunds: stringFromEnvOrDefault(
      'ORCH_MIN_FUNDS_BASE',
      '10000000000000000000'
    ),
    numberOfAccounts: numberFromEnvOrDefault('NUMBER_OF_ACCOUNTS', 10),
    fundsPerAccount: stringFromEnvOrDefault(
      'FUNDS_PER_ACCOUNT_BASE',
      '1000000000000000000'
    ),
    waitForTxToMine: booleanFromEnvOrDefault('WAIT_FOR_TX_MINE', false),
    gasToConsumePerTx: stringFromEnvOrDefault('GAS_CONSUME_PER_TX', '100000'),
    logLevel: logLevelFromEnvOrDefault('LOG_LEVEL', 'info'),
    serverPort: numberFromEnvOrDefault('SERVER_PORT', 8080)
  };
}
