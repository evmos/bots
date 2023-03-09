import {
  generateEndpointGetValidators,
  GetValidatorsResponse
} from '@evmos/provider/dist/rest/staking.js';
import { query } from './query.js';

export async function getValidatorsAddresses(url: string): Promise<string[]> {
  const addresses: string[] = [];
  const res = (await query(
    generateEndpointGetValidators(),
    url
  )) as GetValidatorsResponse;

  if (!res.validators) {
    return addresses;
  }
  for (const v of res.validators) {
    addresses.push(v.operator_address);
  }
  return addresses;
}
