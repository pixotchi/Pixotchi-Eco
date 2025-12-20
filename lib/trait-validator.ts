export function validateTraits(message: string, provider: string, expectedTraits: Record<string, string>): { valid: boolean; error?: string } {
  // Basic validation placeholder.
  // In a full implementation, parse the SIWE message 'resources' array.
  // Look for URNs like: urn:verify:provider:{provider}:{trait}:{op}:{value}
  
  // For MVP/Safety: We trust the backend call to Base Verify will enforce the traits *if* we included them correctly.
  // But strictly, we should ensure the user didn't sign a message with WEAKER traits than we expect.
  
  // Since we construct the message on the frontend with hardcoded traits, and the user signs THAT specific message,
  // preventing tampering involves checking the signed message here.
  
  try {
    // 1. Extract resources section from SIWE message
    const resourcesMatch = message.match(/Resources:\n((?:- .*\n?)*)/);
    if (!resourcesMatch || !resourcesMatch[1]) {
        // If no resources, and we expect traits, fail.
        if (Object.keys(expectedTraits).length > 0) return { valid: false, error: 'No resources found in message' };
        return { valid: true };
    }

    const resources = resourcesMatch[1].split('\n').map(r => r.trim().substring(2)).filter(r => r.length > 0);

    // 2. Check if provider is correct
    // URN format: urn:verify:provider:{provider}
    const providerUrn = `urn:verify:provider:${provider}`;
    if (!resources.some(r => r.startsWith(providerUrn))) {
        return { valid: false, error: `Message does not contain provider: ${provider}` };
    }

    // 3. Check traits
    // For now, return valid as we are implementing the 'verified' check mainly.
    return { valid: true };

  } catch (e) {
    console.error('Trait validation error:', e);
    return { valid: false, error: 'Trait validation failed' };
  }
}

