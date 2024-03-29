import { LogLevel } from './logger.js';
import { providers } from 'ethers';

export function stringFromEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} must be defined in environment variable`);
  }
  return value;
}

export function numberFromEnvOrDefault(key: string, def: number): number {
  let value: string | undefined | number = process.env[key];
  if (value == undefined) {
    value = def;
  }
  return Number(value);
}

export function stringFromEnvOrDefault(key: string, def: string): string {
  let value = process.env[key];
  if (!value) {
    value = def;
  }
  return value;
}

export function stringArrayFromEnvOrDefault(
  key: string,
  def: string[]
): string[] {
  const value = process.env[key];
  if (!value) {
    return def;
  }
  return value.split(',');
}

export function booleanFromEnvOrDefault(key: string, def: boolean): boolean {
  let value: string | undefined | boolean = process.env[key];
  if (value == undefined) {
    value = def;
  } else if (value.toUpperCase() == 'TRUE') {
    value = true;
  } else if (value.toUpperCase() == 'FALSE') {
    value = false;
  } else {
    value = def;
  }
  return value;
}

export function logLevelFromEnvOrDefault(key: string, def: LogLevel): LogLevel {
  const stringVal = stringFromEnvOrDefault(key, def);
  switch (stringVal) {
    case 'info':
    case 'debug':
    case 'warn':
    case 'error':
      return stringVal;
    default:
      return def;
  }
}

export function getExpectedNonce(error: string): number | undefined {
  const expMsg = error.match(/expected\s\d+/g);
  if (expMsg) {
    const expectedNonce = expMsg[0].split(' ')[1];
    return parseInt(expectedNonce);
  }
  return;
}

export async function waitForNextBlock(
  provider: providers.JsonRpcProvider
): Promise<void> {
  const currentBlockNumber = await provider.getBlockNumber();
  return waitForBlock(provider, currentBlockNumber + 1);
}

async function waitForBlock(
  provider: providers.JsonRpcProvider,
  blockNumber: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = async (newBlockNumber: number) => {
      if (newBlockNumber >= blockNumber) {
        provider.off('block', listener);
        resolve();
      }
    };

    provider.on('block', listener);
  });
}
