import { z } from 'zod';

// Agent Tool Schemas
export const listStrainsParams = z.object({
  reason: z.string().optional().describe('Reason for listing strains'),
});

export const mintPlantsParams = z.object({
  count: z.number().int().min(1).max(5).describe('Number of plants to mint'),
  strain: z.number().int().min(2).max(5).optional().describe('Strain ID (2-5)'),
  strainName: z.string().optional().describe('Strain name (Taki, Rosa, Zest, TYJ)'),
  userAddress: z.string().optional().describe('User wallet address - use the one from context'),
  execute: z.boolean().default(false).describe('false=estimate only, true=actually execute the mint'),
});

export type MintPlantsParams = z.infer<typeof mintPlantsParams>;
export type ListStrainsParams = z.infer<typeof listStrainsParams>;

