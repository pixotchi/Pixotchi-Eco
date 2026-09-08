import { BlackjackAction } from '@/public/abi/blackjack-abi';
import BlackjackTransaction, { type BlackjackTransactionProps } from './blackjack-transaction';
import { gameActionButtonClass } from './game-dialog-styles';

type ActionAvailability = Record<BlackjackAction, boolean>;
type SharedTransactionProps = Pick<BlackjackTransactionProps, 'landId' | 'handIndex' | 'onStatusUpdate' | 'onComplete' | 'onPreparedCancel' | 'onError' | 'tokenSymbol' | 'tokenDecimals' | 'bettingToken'>;
type BlackjackActionControlsProps = SharedTransactionProps & {
  ready: boolean;
  pendingAction: BlackjackAction | 'deal' | null;
  available: ActionAvailability;
  fundingDisabled: { double: boolean; split: boolean };
  onPrepare: (action: BlackjackAction) => ReturnType<NonNullable<BlackjackTransactionProps['onButtonClick']>>;
};

const ACTION_ROWS = [
  [
    { action: BlackjackAction.HIT, label: 'Hit', ariaLabel: 'Hit current Blackjack hand', tone: 'primary' },
    { action: BlackjackAction.STAND, label: 'Stand', ariaLabel: 'Stand on current Blackjack hand', tone: 'neutral' },
    { action: BlackjackAction.DOUBLE, label: 'Double', ariaLabel: 'Double current Blackjack hand', tone: 'warning' },
  ],
  [
    { action: BlackjackAction.SPLIT, label: 'Split', ariaLabel: 'Split current Blackjack hand', tone: 'special' },
    { action: BlackjackAction.SURRENDER, label: 'Surrender', ariaLabel: 'Surrender current Blackjack hand', tone: 'neutral' },
  ],
] as const;

export function BlackjackActionControls({ ready, pendingAction, available, fundingDisabled, onPrepare, ...transaction }: BlackjackActionControlsProps) {
  return ACTION_ROWS.map((row, rowIndex) => (
    <div key={rowIndex} className="empty:hidden grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
      {row.map(({ action, label, ariaLabel, tone }) => ready && available[action] && (pendingAction === null || pendingAction === action) && (
        <BlackjackTransaction
          key={action}
          {...transaction}
          mode="action"
          action={action}
          disabled={action === BlackjackAction.DOUBLE ? fundingDisabled.double : action === BlackjackAction.SPLIT ? fundingDisabled.split : false}
          buttonText={label}
          buttonAriaLabel={ariaLabel}
          buttonClassName={gameActionButtonClass(tone, rowIndex === 1)}
          onButtonClick={() => onPrepare(action)}
        />
      ))}
    </div>
  ));
}
