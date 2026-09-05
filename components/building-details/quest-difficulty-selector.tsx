"use client";

import { Flame, Leaf, Swords } from 'lucide-react';
import { ToggleGroup } from '@/components/ui/toggle-group';

const difficulties = [
  { value: 0, name: 'Easy', hours: 3, Icon: Leaf },
  { value: 1, name: 'Med', hours: 6, Icon: Flame },
  { value: 2, name: 'Hard', hours: 12, Icon: Swords },
] as const;

export function QuestDifficultySelector({ value, onChange, label }: {
  value: number;
  onChange: (difficulty: number) => void;
  label: string;
}) {
  return (
    <div className="quest-difficulty min-w-0" data-difficulty={value}>
      <ToggleGroup
        ariaLabel={label}
        value={value}
        onValueChange={next => onChange(Number(next))}
        className="w-full"
        getButtonClassName={option => `quest-difficulty-${option} flex-1 px-1.5 py-1`}
        options={difficulties.map(({ value: option, name, hours, Icon }) => ({
          value: option,
          label: <span className="flex flex-col items-center gap-0.5 leading-none">
            <span className="flex items-center gap-1 text-xs font-semibold"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{name}</span>
            <span className="text-[10px] leading-3 opacity-85">{hours}h</span>
          </span>,
        }))}
      />
    </div>
  );
}
