import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userAddress = "0xDaAd8aCA35e5822816dbCD294dA8A3f5DAD0C1B5" } = body;

    // Simulate the conversation flow that was failing
    const conversations = [
      {
        prompt: "mint 1 plant for me",
        conversationHistory: []
      },
      {
        prompt: "confirm",
        conversationHistory: [
          { role: "user", content: "mint 1 plant for me" },
          { role: "assistant", content: "The estimated cost to mint 1 Pixotchi plant (strain: Flora) is 10 SEED tokens. If you would like to proceed with the minting, please confirm, and I will execute the transaction for you." }
        ]
      }
    ];

    const results = [];
    
    for (const conv of conversations) {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: conv.prompt,
          userAddress,
          conversationHistory: conv.conversationHistory
        })
      });

      const result = await response.json();
      results.push({
        prompt: conv.prompt,
        response: result.text,
        toolResults: result.toolResults
      });
    }

    return NextResponse.json({
      success: true,
      testResults: results,
      message: "Conversation flow test completed"
    });

  } catch (error: any) {
    console.error('Conversation test error:', error);
    return NextResponse.json({ 
      success: false,
      error: error.message || 'Test failed' 
    }, { status: 500 });
  }
}
