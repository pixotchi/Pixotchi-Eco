import type { BarracksRaidReportV2 } from '@/lib/types';
import { hasReport, formatBarracksPoints, formatBarracksLifetime } from '@/lib/barracks-view';
import { BarracksBattleTable as BattleReportTable } from './barracks-battle-table';
import { ResourceState } from '@/components/ui/resource-state';
export type ReportMode = 'outgoing' | 'incoming';
const ZERO_BIGINT = BigInt(0);
const HIDDEN_REPORT_VALUE = '?';
export function BarracksReportCard({
  report,
  mode,
  previewEnabled = false,
  onRetry,
}: {
  report: BarracksRaidReportV2 | null;
  mode: ReportMode;
  previewEnabled?: boolean;
  onRetry?: () => void;
}) {
  if (report === null) {
    return <ResourceState status="error" title={`${mode === 'outgoing' ? 'Attack' : 'Defense'} report unavailable`} description="The report could not be loaded. Try again to check the result." onRetry={onRetry} />;
  }
  if (!hasReport(report)) {
    return (
      <div className="space-y-2 [overflow-wrap:anywhere]">
        <div className="text-sm font-semibold">
          {mode === "outgoing" ? "Last Attack" : "Last Defense"}
        </div>
        <p className="text-sm text-muted-foreground">
          No {mode === "outgoing" ? "attack" : "defense"} report recorded yet.
        </p>
      </div>
    );
  }

  const success = mode === "outgoing" ? report.attackerWon : !report.attackerWon;
  const opponentLabel =
    mode === "outgoing"
      ? `Target Land #${report.defenderLandId.toString()}`
      : `Attacker Land #${report.attackerLandId.toString()}`;
  const attackersReturned =
    report.survivingAttackerSwordsmen + report.survivingAttackerPhalanx > ZERO_BIGINT;
  const shouldHideOutgoingIntel =
    mode === "outgoing" && !previewEnabled && !attackersReturned;
  const defenderDisplayValue = (value: bigint): bigint | string =>
    shouldHideOutgoingIntel ? HIDDEN_REPORT_VALUE : value;

  return (
    <div className="space-y-3 [overflow-wrap:anywhere]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {mode === "outgoing" ? "Last Attack" : "Last Defense"}
          </div>
          <div className="text-xs text-muted-foreground">
            Raid #{report.raidId.toString()} • {opponentLabel}
          </div>
        </div>
        <div className={`shrink-0 text-xs font-semibold ${success ? "text-[hsl(var(--success-strong))]" : "text-destructive"}`}>
          {success ? "Won" : "Lost"}
        </div>
      </div>

      <div className="space-y-3">
        <BattleReportTable
          label="Attacker"
          landId={report.attackerLandId}
          swordsmenSent={report.swordsmenSent}
          phalanxSent={report.phalanxSent}
          swordsmenLost={report.attackerSwordsmenLost}
          phalanxLost={report.attackerPhalanxLost}
        />
        <BattleReportTable
          label="Defender"
          landId={report.defenderLandId}
          swordsmenSent={defenderDisplayValue(report.defenderSwordsmenBefore)}
          phalanxSent={defenderDisplayValue(report.defenderPhalanxBefore)}
          swordsmenLost={defenderDisplayValue(report.defenderSwordsmenLost)}
          phalanxLost={defenderDisplayValue(report.defenderPhalanxLost)}
        />
      </div>

      <div className="border-t border-border/60 pt-3 text-sm [overflow-wrap:anywhere]">
        <span className="font-semibold">Raided:</span>{" "}
        {shouldHideOutgoingIntel ? (
          <span>None of your troops came back.</span>
        ) : (
          <>
            <span className="text-primary">{formatBarracksPoints(report.pointsStolen)} PTS</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-primary">{formatBarracksLifetime(report.lifetimeStolen)} lifetime</span>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Settled {formatBarracksPoints(report.pendingPointsSettled)} pending PTS and{" "}
        {formatBarracksLifetime(report.pendingLifetimeSettled)} pending lifetime on{" "}
        {new Date(Number(report.timestamp) * 1000).toLocaleString()}.
      </div>
    </div>
  );
}
