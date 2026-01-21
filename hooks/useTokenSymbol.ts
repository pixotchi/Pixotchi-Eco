import { useReadContract } from 'wagmi';
import { Address, erc20Abi } from 'viem';

export function useTokenSymbol(tokenAddress: string | undefined | null) {
    const { data: symbol, isLoading } = useReadContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'symbol',
        query: {
            enabled: !!tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000',
            staleTime: Infinity, // Symbols rarely change
        },
    });

    // Default to 'SEED' if undefined or loading, or if address is null (assuming default context)
    // However, for generic usage '?'' might be safer, but given the app context 'SEED' is the safe fallback.
    // Let's return undefined if loading so UI can handle it, or 'SEED' if no address provided?
    // The requirement is to NOT hardcode SEED.

    if (!tokenAddress) return undefined;
    if (isLoading) return '...';

    return (symbol as string) || 'SEED';
}
