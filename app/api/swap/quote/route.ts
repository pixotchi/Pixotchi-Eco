import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

/**
 * Swap Quote API
 * 
 * Fetches ETH→SEED quotes directly from BaseSwap router on-chain.
 * This is more reliable than CDP API and doesn't require special auth.
 */

// SEED token on Base
const SEED_TOKEN_ADDRESS = "0x546D239032b24eCEEE0cb05c92FC39090846adc7";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const BASESWAP_ROUTER = "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86";

const ROUTER_ABI = parseAbi([
    "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)",
]);

// Create public client for reading on-chain data
const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
});

interface QuoteRequest {
    from: {
        address: string;
        chainId: number;
        decimals: number;
        symbol: string;
    };
    to: {
        address: string;
        chainId: number;
        decimals: number;
        symbol: string;
    };
    amount: string;
    amountReference: "from" | "to";
}

export async function POST(request: NextRequest) {
    try {
        const body: QuoteRequest = await request.json();

        const { amount } = body;

        if (!amount || amount === "0") {
            return NextResponse.json(
                { error: "Missing or zero amount" },
                { status: 400 }
            );
        }

        const seedAmount = BigInt(amount);

        try {
            // Call BaseSwap router getAmountsIn to find how much ETH is needed for X SEED
            const path = [WETH_ADDRESS, SEED_TOKEN_ADDRESS] as const;

            const amounts = await publicClient.readContract({
                address: BASESWAP_ROUTER as `0x${string}`,
                abi: ROUTER_ABI,
                functionName: "getAmountsIn",
                args: [seedAmount, [...path]],
            });

            const ethAmountWei = amounts[0];

            // Add 2% buffer for slippage (reduced from 5%)
            const ethWithBuffer = (ethAmountWei * BigInt(102)) / BigInt(100);

            console.log("[SwapQuoteAPI] On-chain quote:", {
                seedAmount: seedAmount.toString(),
                ethNeeded: ethAmountWei.toString(),
                ethWithBuffer: ethWithBuffer.toString(),
            });

            return NextResponse.json({
                fromAmount: ethWithBuffer.toString(),
                toAmount: amount,
                rawEthAmount: ethAmountWei.toString(),
                source: "baseswap",
            });

        } catch (onChainError) {
            console.error("[SwapQuoteAPI] On-chain quote failed:", onChainError);

            // No fallback - return error so client can handle appropriately
            // Using hardcoded rates is dangerous as market prices fluctuate
            return NextResponse.json(
                {
                    error: "Unable to fetch quote from DEX. Please try again.",
                    code: "QUOTE_FAILED"
                },
                { status: 503 }
            );
        }

    } catch (error) {
        console.error("[SwapQuoteAPI] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
