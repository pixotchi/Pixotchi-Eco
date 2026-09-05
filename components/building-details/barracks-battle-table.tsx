import Image from 'next/image';

type Count = bigint | string;
function TroopValue({ value }: { value: Count }) {
  return value === '?' ? <abbr title="Unknown: no surviving troops returned" className="cursor-help no-underline">?</abbr> : <>{value.toString()}</>;
}

/** A real table keeps troop headers associated with counts in both report directions. */
export function BarracksBattleTable({ label, landId, swordsmenSent, phalanxSent, swordsmenLost, phalanxLost }: {
  label: string; landId?: bigint; swordsmenSent: Count; phalanxSent: Count; swordsmenLost: Count; phalanxLost: Count;
}) {
  return <table className="w-full table-fixed border-collapse text-xs tabular-nums [overflow-wrap:anywhere]">
    <caption className="border-b border-border/60 py-2 text-left font-semibold text-foreground">
      <span className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{label}</span>{landId !== undefined && <span className="text-muted-foreground">Land #{landId.toString()}</span>}</span>
    </caption>
    <thead><tr>
      <th scope="col" className="w-[34%] py-2 text-left font-medium text-muted-foreground"><span className="sr-only">Report measure</span></th>
      {(['swordsman', 'phalanx'] as const).map(troop => <th key={troop} scope="col" className="px-1 py-2 font-medium">
        <span className="flex flex-col items-center gap-1"><Image src={`/icons/${troop}.png`} alt="" width={20} height={20} />{troop === 'swordsman' ? 'Swordsman' : 'Phalanx'}</span>
      </th>)}
    </tr></thead>
    <tbody>{([
      ['Troops', swordsmenSent, phalanxSent], ['Casualties', swordsmenLost, phalanxLost],
    ] as const).map(([measure, ...values]) => <tr key={measure} className="border-t border-border/50">
      <th scope="row" className="py-2 text-left font-medium text-muted-foreground">{measure}</th>
      {values.map((value, index) => <td key={index} className={`px-1 py-2 text-center font-medium ${measure === 'Casualties' && typeof value === 'bigint' && value > BigInt(0) ? 'text-destructive' : 'text-foreground'}`}><TroopValue value={value} /></td>)}
    </tr>)}</tbody>
  </table>;
}
