declare global {
  /**
   * Compatibility type for legacy dynamic boundaries that previously used explicit `any`.
   * Prefer concrete domain types or `unknown` with guards for new code.
   */
  type UntypedValue = ReturnType<typeof JSON.parse>;
}

export {};
