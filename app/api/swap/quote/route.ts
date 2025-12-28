import { NextRequest, NextResponse } from "next/server";

/**
 * Swap Quote API
 * 
 * Proxies requests to OnchainKit's quote service to get ETH→SEED quotes.
 * This allows the frontend to get programmatic quotes without exposing API keys.
 */

const ONCHAINKIT_CDP_API_URL = "https://api.developer.coinbase.com/rpc/v1/base";

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

        const { from, to, amount, amountReference } = body;

        if (!from || !to || !amount) {
            return NextResponse.json(
                { error: "Missing required parameters: from, to, amount" },
                { status: 400 }
            );
        }

        const apiKey = process.env.CDP_API_KEY || process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: "CDP API key not configured" },
                { status: 500 }
            );
        }

        // Use the CDP Quote API
        // Reference: https://docs.base.org/onchainkit/latest/utilities/get-swap-quote
        const quoteResponse = await fetch(`${ONCHAINKIT_CDP_API_URL}/${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "cdp_getSwapQuote",
                params: [{
                    fromAddress: from.address || undefined, // undefined for native ETH
                    toAddress: to.address,
                    fromChainId: from.chainId,
                    toChainId: to.chainId,
                    amount: amount,
                    // If amountReference is "to", we're specifying output amount (SEED)
                    // and want to know input amount (ETH)
                    isAmountInToToken: amountReference === "to",
                }],
            }),
        });

        if (!quoteResponse.ok) {
            const errorText = await quoteResponse.text();
            console.error("[SwapQuoteAPI] CDP API error:", errorText);
            return NextResponse.json(
                { error: `Quote service error: ${quoteResponse.status}` },
                { status: 502 }
            );
        }

        const quoteData = await quoteResponse.json();

        if (quoteData.error) {
            console.error("[SwapQuoteAPI] Quote error:", quoteData.error);
            return NextResponse.json(
                { error: quoteData.error.message || "Quote failed" },
                { status: 400 }
            );
        }

        const result = quoteData.result;

        return NextResponse.json({
            fromAmount: result?.fromAmount || result?.inputAmount,
            toAmount: result?.toAmount || result?.outputAmount,
            priceImpact: result?.priceImpact,
            route: result?.route,
            estimatedGas: result?.estimatedGas,
        });

    } catch (error) {
        console.error("[SwapQuoteAPI] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
