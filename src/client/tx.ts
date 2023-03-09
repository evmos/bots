import { generateEndpointBroadcast } from 'evmosjs/packages/provider/dist/rest/broadcast.js';
import { query } from './query.js';

export async function getTransactionDetailsByHash(
  url: string,
  txHash: string
): Promise<object> {
  return (await query(
    `${generateEndpointBroadcast()}/${txHash}`,
    url
  )) as object;
}
