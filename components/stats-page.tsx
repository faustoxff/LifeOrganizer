"use client";

import Image from "next/image";
import { Lock, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { statsExtraCopy } from "@/lib/focus-copy";
import { miloFace } from "@/lib/milo-face";
import { StreakBadges } from "@/components/streak-badges";
import { WorkPatterns } from "@/components/work-patterns";
import type { UserPatterns } from "@/lib/user-patterns";
import { useUserPlan } from "@/lib/use-user-plan";
import { cn } from "@/lib/utils";

type StatsData = {
  completionRate: number;
  completedByWeek: { weekStart: string; count: number }[];
  byCategory: { category: string; count: number; isOther?: boolean }[];
  lastDays: { date: string; count: number }[];
  activeStreak: number;
  bestStreak: number;
  totalCompleted: number;
  totalPending: number;
  encouragement: string;
  /** Lo aprendido de los últimos 90 días. null si no se pudo calcular. */
  patterns?: UserPatterns | null;
};



export function StatsPage() {
  const router = useRouter();
  const { copy, language } = useAppLanguage();
  const extra = statsExtraCopy[language];
  const { plan, isLoaded: planLoaded } = useUserPlan();
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!planLoaded || plan !== "pro") return;
    let active = true;
    async function load() {
      try {
        const res = await fetch(`/api/stats?lang=${language}`);
        if (!res.ok) throw new Error();
        const json = (await res.json()) as StatsData;
        if (active) setData(json);
      } catch {
        if (active) setError(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [planLoaded, plan, language]);

  if (planLoaded && plan !== "pro") {
    return <StatsLocked onBack={() => router.push("/app")} />;
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-6 sm:px-8 lg:h-dvh lg:overflow-y-auto lg:py-8">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col">
        <div className="mb-5 flex flex-shrink-0 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{copy.stats.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{copy.stats.subtitle}</p>
          </div>
          <Link
            href="/app"
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary"
          >
            {copy.stats.back}
          </Link>
        </div>

        {error && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {copy.errors.unexpected}
          </p>
        )}

        {!data && !error && (
          <div className="flex justify-center py-20 text-sm text-muted-foreground">
            {copy.stats.loading}
          </div>
        )}

        {data && (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_minmax(0,1fr)]">
            {/* Milo's read of the numbers, across the top */}
            {data.encouragement && (
              <motion.div
                className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 lg:col-span-3"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <Image
                  src={miloFace(data.activeStreak >= 3 ? "orgulloso" : "animando")}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 flex-shrink-0 object-contain"
                />
                <p className="text-sm leading-relaxed text-foreground">{data.encouragement}</p>
              </motion.div>
            )}

            {/* Left: the streak, given the room it deserves */}
            <div className="lg:row-span-1">
              <StreakBadges currentStreak={data.activeStreak} bestStreak={data.bestStreak} />
            </div>

            {/* Right: the numbers and the two charts, stacked */}
            <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
              <div className="grid flex-shrink-0 grid-cols-3 gap-3">
                <StatTile label={copy.stats.completed} value={data.totalCompleted} />
                <StatTile label={copy.stats.pending} value={data.totalPending} />
                <StatTile
                  label={copy.stats.completionRate}
                  value={data.completionRate}
                  suffix="%"
                  meter={data.completionRate}
                />
              </div>

              <div className="flex-shrink-0 rounded-2xl border border-border bg-card p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {extra.lastDays}
                </p>
                <ActivityStrip data={data.lastDays} language={language} unit={extra.tasksUnit} empty={extra.noActivity} />
              </div>

              <div className="grid min-h-0 gap-4 sm:grid-cols-2">
                <div className="min-h-0 rounded-2xl border border-border bg-card p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {copy.stats.weeklyTrend}
                  </p>
                  <WeeklyTrendChart data={data.completedByWeek} language={language} unit={extra.tasksUnit} empty={extra.emptyChart} />
                </div>

                <div className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-card p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {copy.stats.byCategory}
                  </p>
                  <CategoryBars data={data.byCategory} otherLabel={extra.other} unit={extra.tasksUnit} />
                </div>
              </div>
            </div>
            {data.patterns && (
              <div className="lg:col-span-3">
                <WorkPatterns patterns={data.patterns} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  icon,
  meter
}: {
  label: string;
  value: number;
  suffix?: string;
  icon?: React.ReactNode;
  meter?: number;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold">
        <AnimatedNumber value={value} />
        {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
        {icon}
      </p>
      {meter !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${meter}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
}

function formatDay(iso: string, language: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(language, opts).format(new Date(`${iso}T12:00:00`));
}

/** One cell per day: filled means "I finished something that day". */
function ActivityStrip({
  data,
  language,
  unit,
  empty
}: {
  data: { date: string; count: number }[];
  language: string;
  unit: string;
  empty: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const anyActivity = data.some((d) => d.count > 0);

  return (
    <div>
      <div className="flex items-end gap-1.5">
        {data.map((day) => {
          // One hue, four steps: the step encodes how much, not which.
          const level = day.count === 0 ? 0 : Math.ceil((day.count / max) * 3);
          return (
            <div
              key={day.date}
              className="group relative flex-1"
              title={`${formatDay(day.date, language, { day: "numeric", month: "short" })} · ${day.count} ${unit}`}
            >
              <div
                className={cn(
                  "h-9 w-full rounded-md transition-colors",
                  level === 0 && "bg-secondary/50",
                  level === 1 && "bg-primary/30",
                  level === 2 && "bg-primary/60",
                  level >= 3 && "bg-primary"
                )}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{formatDay(data[0].date, language, { day: "numeric", month: "short" })}</span>
        <span>{formatDay(data[data.length - 1].date, language, { day: "numeric", month: "short" })}</span>
      </div>
      {!anyActivity && <p className="mt-3 text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

function WeeklyTrendChart({
  data,
  language,
  unit,
  empty
}: {
  data: { weekStart: string; count: number }[];
  language: string;
  unit: string;
  empty: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.every((d) => d.count === 0)) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 560;
  const height = 150;
  const padX = 12;
  const padTop = 22;
  const padBottom = 26;
  const stepX = (width - padX * 2) / Math.max(1, data.length - 1);
  const yFor = (count: number) => padTop + (1 - count / max) * (height - padTop - padBottom);

  const points = data.map((d, i) => ({ x: padX + i * stepX, y: yFor(d.count), ...d }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padBottom} L ${points[0].x} ${height - padBottom} Z`;
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${max} ${unit}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive baseline and midline give the values something to sit against. */}
        <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} stroke="hsl(var(--border))" strokeWidth={1} />
        <line x1={padX} y1={yFor(max)} x2={width - padX} y2={yFor(max)} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="3 4" />
        <text x={padX} y={yFor(max) - 7} fontSize={11} fill="hsl(var(--muted-foreground))">{max}</text>

        <path d={areaPath} fill="hsl(var(--primary))" opacity={0.12} />
        <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <g key={p.weekStart}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 6 : 4}
              fill="hsl(var(--primary))"
              stroke="hsl(var(--card))"
              strokeWidth={2}
            />
            {/* Generous invisible hit area, so pointing is easy. */}
            <rect
              x={p.x - stepX / 2}
              y={0}
              width={stepX}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          </g>
        ))}

        {/* Only the ends are labelled: a number on every point is noise. */}
        <text x={padX} y={height - 8} fontSize={11} fill="hsl(var(--muted-foreground))">
          {formatDay(points[0].weekStart, language, { day: "numeric", month: "short" })}
        </text>
        <text x={width - padX} y={height - 8} fontSize={11} textAnchor="end" fill="hsl(var(--muted-foreground))">
          {formatDay(points[points.length - 1].weekStart, language, { day: "numeric", month: "short" })}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(active.x / width) * 100}%`, top: `${(active.y / height) * 100}%` }}
        >
          <p className="font-semibold tabular-nums">{active.count} {unit}</p>
          <p className="text-muted-foreground">
            {formatDay(active.weekStart, language, { day: "numeric", month: "short" })}
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryBars({
  data,
  otherLabel,
  unit
}: {
  data: { category: string; count: number; isOther?: boolean }[];
  otherLabel: string;
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((item, i) => {
        const label = item.isOther ? otherLabel : item.category;
        return (
          <div key={label} className="flex items-center gap-3">
            <span className="w-24 flex-shrink-0 truncate text-xs text-muted-foreground" title={label}>
              {label}
            </span>
            {/* One measure across categories is magnitude, so one hue: the length
                already says which is bigger. A different colour per row would
                imply the colours mean something. */}
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-secondary/40">
              <motion.div
                className={cn("h-full rounded-md", item.isOther ? "bg-primary/40" : "bg-primary")}
                initial={{ width: 0 }}
                animate={{ width: `${(item.count / max) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: "easeOut" }}
              />
            </div>
            <span className="w-6 flex-shrink-0 text-right text-xs font-semibold tabular-nums" aria-label={`${item.count} ${unit}`}>
              {item.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatsLocked({ onBack }: { onBack: () => void }) {
  const { copy } = useAppLanguage();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-bold">{copy.stats.lockedTitle}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{copy.stats.lockedSubtitle}</p>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" onClick={onBack}>
          {copy.stats.back}
        </Button>
        <Link href="/plans">
          <Button className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            {copy.stats.upgradeToPro}
          </Button>
        </Link>
      </div>
    </div>
  );
}
