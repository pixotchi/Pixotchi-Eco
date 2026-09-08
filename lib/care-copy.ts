/** Catalog names stay intact, including names that are already plural or uncountable. */
export function carePurchaseLabel(name: string, quantity: number): string {
  if (quantity <= 0) return 'Choose quantity';
  return quantity === 1 ? `Buy ${name}` : `Buy ${quantity} × ${name}`;
}
