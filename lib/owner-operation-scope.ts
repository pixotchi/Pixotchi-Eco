/** Invalidates async work when its owner changes, including A → B → A. */
export class OwnerOperationScope {
  private owner: string | null;
  private generation = 0;

  constructor(owner: string | null) { this.owner = owner; }

  setOwner(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner;
      this.invalidate();
    }
  }

  invalidate() { this.generation += 1; }

  capture() {
    const generation = this.generation;
    const owner = this.owner;
    return { owner, isCurrent: () => generation === this.generation && owner === this.owner };
  }
}
