import { useEffect, useId } from 'react';
type Props = { buttonText?: string; actionButtonText?: string; buttonClassName?: string; disabled?: boolean; onButtonClick?: () => void | Promise<void>; onSuccess?: (receipt: object) => void };
const completions: Array<() => void> = [];
export default function Transaction({ buttonText, actionButtonText, buttonClassName, disabled, onButtonClick, onSuccess }: Props) {
  const id = useId();
  useEffect(() => {
    const complete = () => completions.shift()?.();
    window.addEventListener('fixture-transaction-success', complete);
    return () => window.removeEventListener('fixture-transaction-success', complete);
  }, []);
  return <button data-transaction-controller data-controller-id={id} className={buttonClassName} disabled={disabled} onClick={async () => {
    await onButtonClick?.();
    completions.push(() => onSuccess?.({}));
  }}>{buttonText ?? actionButtonText ?? 'Submit transaction'}</button>;
}
