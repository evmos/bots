import { getConfig } from './bot.config.js';
import { LoggerService } from './common/logger.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { runServer } from './server/server.js';

async function run() {
  const config = getConfig();

  const logger = LoggerService.configure({
    logLevel: config.logLevel
  }).get();

  process.on('uncaughtException', (err) => {
    logger.error(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (err) => {
    logger.error(err);
    process.exit(1);
  });

  runServer({
    rpcUrl: config.rpcUrl,
    port: config.serverPort,
    logger: logger
  });

  const orchestrator = new Orchestrator({
    orchestratorAccountPrivKey: config.orchestratorAccountPrivateKey,
    numberOfWorkers: config.numberOfWorkers,
    fundAllocationPerAccountBASE: config.fundsPerAccount,
    minFundsOrchestrator: config.orchestratorMinFunds,
    rpcUrl: config.rpcUrl,
    apiUrl: config.apiUrl,
    waitForTxMine: config.waitForTxToMine,
    gasToConsumePerTx: config.gasToConsumePerTx,
    logger: logger,
    chainId: config.chainId,
    cosmosChainId: config.cosmosChainId
  });

  runServer({
    port: config.serverPort,
    logger: logger,
    orchestrator: orchestrator
  });
  await orchestrator.initialize();
}

run();
