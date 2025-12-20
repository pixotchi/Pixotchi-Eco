/**
 * Trait Validator for Base Verify SIWE Messages
 * 
 * This module validates that trait requirements in SIWE messages match
 * what the backend expects. This prevents users from modifying trait
 * requirements on the frontend to bypass access controls.
 * 
 * @see https://verify.base.dev - Base Verify Documentation
 */

export interface TraitValidationResult {
  valid: boolean;
  error?: string;
  parsedTraits?: ParsedTrait[];
  parsedAction?: string;
}

export interface ParsedTrait {
  provider: string;
  trait: string;
  operation: string;
  value: string;
}

export interface ExpectedTraits {
  [traitName: string]: string; // e.g., { 'verified': 'true', 'followers': 'gte:100' }
}

/**
 * Parse a trait URN into its components
 * Format: urn:verify:provider:{provider}:{trait}:{operation}:{value}
 * Example: urn:verify:provider:x:followers:gte:1000
 */
function parseTraitUrn(urn: string): ParsedTrait | null {
  // Match trait URNs with format: urn:verify:provider:{provider}:{trait}:{op}:{value}
  const traitMatch = urn.match(/^urn:verify:provider:([^:]+):([^:]+):([^:]+):(.+)$/);
  if (traitMatch) {
    return {
      provider: traitMatch[1],
      trait: traitMatch[2],
      operation: traitMatch[3],
      value: traitMatch[4],
    };
  }
  return null;
}

/**
 * Parse action from URN
 * Format: urn:verify:action:{action_name}
 */
function parseActionUrn(urn: string): string | null {
  const actionMatch = urn.match(/^urn:verify:action:(.+)$/);
  return actionMatch ? actionMatch[1] : null;
}

/**
 * Check if a URN is just a provider declaration (no traits)
 * Format: urn:verify:provider:{provider}
 */
function isProviderOnlyUrn(urn: string, provider: string): boolean {
  return urn === `urn:verify:provider:${provider}`;
}

/**
 * Compare trait values with operations
 */
function compareTraitValue(
  actualOp: string,
  actualValue: string,
  expectedOp: string,
  expectedValue: string
): boolean {
  // Normalize operations
  const normalizeOp = (op: string) => op.toLowerCase();
  const aOp = normalizeOp(actualOp);
  const eOp = normalizeOp(expectedOp);

  // For boolean traits (eq:true, eq:false)
  if (aOp === 'eq' && eOp === 'eq') {
    return actualValue.toLowerCase() === expectedValue.toLowerCase();
  }

  // For numeric comparisons, we need to ensure the actual requirement
  // is AT LEAST as strict as the expected requirement
  const numericOps = ['gt', 'gte', 'lt', 'lte'];
  if (numericOps.includes(aOp) && numericOps.includes(eOp)) {
    const actualNum = parseInt(actualValue, 10);
    const expectedNum = parseInt(expectedValue, 10);

    if (isNaN(actualNum) || isNaN(expectedNum)) {
      return false;
    }

    // For "greater than" operations, actual must be >= expected threshold
    // e.g., if we expect gte:100, user can't sign gte:50 (that's weaker)
    if ((eOp === 'gt' || eOp === 'gte') && (aOp === 'gt' || aOp === 'gte')) {
      return actualNum >= expectedNum;
    }

    // For "less than" operations, actual must be <= expected threshold
    if ((eOp === 'lt' || eOp === 'lte') && (aOp === 'lt' || aOp === 'lte')) {
      return actualNum <= expectedNum;
    }

    // Mixed operations (e.g., expected gt but got lte) - not compatible
    return false;
  }

  // For string equality
  if (aOp === 'eq' || eOp === 'eq') {
    return aOp === eOp && actualValue === expectedValue;
  }

  // For 'in' operation (comma-separated list)
  if (aOp === 'in' && eOp === 'in') {
    const actualSet = new Set(actualValue.split(',').map(v => v.trim().toUpperCase()));
    const expectedSet = new Set(expectedValue.split(',').map(v => v.trim().toUpperCase()));
    
    // Actual set must be a subset of expected set (can't add more allowed values)
    for (const v of actualSet) {
      if (!expectedSet.has(v)) {
        return false;
      }
    }
    return true;
  }

  // Default: exact match required
  return aOp === eOp && actualValue === expectedValue;
}

/**
 * Extract resources from a SIWE message
 * SIWE messages have a "Resources:" section with URNs listed as "- urn:..."
 */
function extractResources(message: string): string[] {
  const resourcesMatch = message.match(/Resources:\n((?:- .*\n?)*)/);
  if (!resourcesMatch || !resourcesMatch[1]) {
    return [];
  }

  return resourcesMatch[1]
    .split('\n')
    .map(r => r.trim())
    .filter(r => r.startsWith('- '))
    .map(r => r.substring(2).trim())
    .filter(r => r.length > 0);
}

/**
 * Validate that a SIWE message contains the expected trait requirements.
 * 
 * This is a CRITICAL security function that prevents users from signing
 * SIWE messages with weaker trait requirements than what the backend expects.
 * 
 * @param message - The raw SIWE message string that was signed
 * @param provider - The expected provider (e.g., 'x', 'coinbase', 'instagram', 'tiktok')
 * @param expectedTraits - Map of trait names to expected values (e.g., { 'followers': 'gte:100' })
 * @param expectedAction - Optional: The expected action name
 * @returns Validation result with error details if invalid
 */
export function validateTraits(
  message: string,
  provider: string,
  expectedTraits: ExpectedTraits,
  expectedAction?: string
): TraitValidationResult {
  try {
    // 1. Extract resources section from SIWE message
    const resources = extractResources(message);

    if (resources.length === 0) {
      // If no resources and we expect traits, fail
      if (Object.keys(expectedTraits).length > 0) {
        return { valid: false, error: 'No resources found in SIWE message' };
      }
      // If no expected traits and no resources, that's OK
      return { valid: true, parsedTraits: [], parsedAction: undefined };
    }

    // 2. Check if provider is present in the message
    const hasProviderUrn = resources.some(r => 
      r === `urn:verify:provider:${provider}` || 
      r.startsWith(`urn:verify:provider:${provider}:`)
    );

    if (!hasProviderUrn) {
      return { valid: false, error: `Message does not contain provider: ${provider}` };
    }

    // 3. Parse all traits and action from message
    const parsedTraits: ParsedTrait[] = [];
    let parsedAction: string | undefined;

    for (const urn of resources) {
      // Skip provider-only URNs
      if (isProviderOnlyUrn(urn, provider)) continue;

      // Check for action
      const action = parseActionUrn(urn);
      if (action) {
        parsedAction = action;
        continue;
      }

      // Parse trait
      const trait = parseTraitUrn(urn);
      if (trait && trait.provider === provider) {
        parsedTraits.push(trait);
      }
    }

    // 4. Validate action if expected
    if (expectedAction && parsedAction !== expectedAction) {
      return { 
        valid: false, 
        error: `Expected action '${expectedAction}' but got '${parsedAction || 'none'}'`,
        parsedTraits,
        parsedAction 
      };
    }

    // 5. Validate each expected trait is present and meets requirements
    for (const [traitName, expectedValue] of Object.entries(expectedTraits)) {
      // Parse expected value (format: "value" or "op:value")
      let expectedOp = 'eq';
      let expectedVal = expectedValue;
      
      const opMatch = expectedValue.match(/^(eq|gt|gte|lt|lte|in):(.+)$/);
      if (opMatch) {
        expectedOp = opMatch[1];
        expectedVal = opMatch[2];
      }

      // Find matching trait in parsed traits
      const matchingTrait = parsedTraits.find(t => t.trait === traitName);

      if (!matchingTrait) {
        return { 
          valid: false, 
          error: `Required trait '${traitName}' not found in message`,
          parsedTraits,
          parsedAction 
        };
      }

      // Validate the trait value/operation is at least as strict as expected
      const isValid = compareTraitValue(
        matchingTrait.operation,
        matchingTrait.value,
        expectedOp,
        expectedVal
      );

      if (!isValid) {
        return { 
          valid: false, 
          error: `Trait '${traitName}' requirement mismatch: expected ${expectedOp}:${expectedVal}, got ${matchingTrait.operation}:${matchingTrait.value}`,
          parsedTraits,
          parsedAction 
        };
      }
    }

    // All validations passed
    return { valid: true, parsedTraits, parsedAction };

  } catch (e) {
    console.error('Trait validation error:', e);
    return { valid: false, error: 'Trait validation failed due to parsing error' };
  }
}

/**
 * Validate that a SIWE message contains the expected action.
 * Simpler version when only action validation is needed (no trait requirements).
 */
export function validateAction(
  message: string,
  provider: string,
  expectedAction: string
): TraitValidationResult {
  return validateTraits(message, provider, {}, expectedAction);
}

/**
 * Extract the action name from a SIWE message
 */
export function extractAction(message: string): string | null {
  const resources = extractResources(message);
  for (const urn of resources) {
    const action = parseActionUrn(urn);
    if (action) return action;
  }
  return null;
}
