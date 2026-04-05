import { type Transport } from 'viem';
import {
  createBaseRpcTransport,
  getPrimaryRpcEndpoint,
  listBaseRpcEndpoints,
} from './base-rpc';

export const getRpcEndpoints = (): string[] => listBaseRpcEndpoints();

export const createResilientTransport = (
  inputEndpoints?: string[],
): Transport => createBaseRpcTransport('read', inputEndpoints);

export { getPrimaryRpcEndpoint };
