import express from 'express';
import promBundle from 'express-prom-bundle';
import { Logger } from '../common/logger';
import { Orchestrator } from '../orchestrator/orchestrator';

export interface ServerParams {
  port: number;
  logger: Logger;
  orchestrator: Orchestrator;
}

export async function runServer(params: ServerParams) {
  const app = express();
  const port = params.port; // default port to listen
  app.use(express.json());

  const metricsMiddleware = promBundle({
    includeMethod: true,
    includePath: true,
    includeStatusCode: true,
    includeUp: true,
    customLabels: {
      application: 'tx_bot'
    },
    promClient: {
      collectDefaultMetrics: {}
    }
  });

  app.post('/add_worker', (req, res) => {
    console.log(req.body);
    let worker = req.body['worker'];
    if (!('worker' in req.body)) {
      worker = 'default';
    }
    const workerParams = req.body['params'];
    params.orchestrator.addWorker(worker, workerParams);
    res.send('Added worker ' + worker + '\n');
  });

  app.post('/delete_worker', (req, res) => {
    console.log(req.body);
    let worker = req.body['worker'];
    if (!('worker' in req.body)) {
      worker = 'default';
    }
    params.orchestrator.killWorker(worker);
    res.send('Deleted worker ' + worker + '\n');
  });

  app.use(metricsMiddleware);

  // start the express server
  app.listen(port, '0.0.0.0', () => {
    // tslint:disable-next-line:no-console
    params.logger.info(`server started at http://0.0.0.0:${port}`);
  });
}
