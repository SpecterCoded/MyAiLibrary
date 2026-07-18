import {
  Activity,
  BookOpen,
  Brain,
  CircleGauge,
  GitBranch,
  Layers3,
  Network,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { KnowledgeStatistic } from "./types";

const ICONS: Record<KnowledgeStatistic["icon"], LucideIcon> = {
  concepts: Brain,
  relationships: GitBranch,
  stages: Layers3,
  confidence: CircleGauge,
  topics: Network,
  difficulty: Activity,
  chapters: BookOpen,
  status: ShieldCheck,
};

function StatisticCard({ statistic, index }: { statistic: KnowledgeStatistic; index: number }) {
  const Icon = ICONS[statistic.icon];
  return (
    <article className={`kx-stat-card is-${statistic.tone}`} style={{ animationDelay: `${index * 45}ms` }}>
      <span className="kx-stat-icon"><Icon size={16} /></span>
      <div>
        <span>{statistic.label}</span>
        <strong>{statistic.value}</strong>
        <small>{statistic.detail}</small>
      </div>
    </article>
  );
}

export default function KnowledgeStats({ statistics }: { statistics: KnowledgeStatistic[] }) {
  return (
    <section className="kx-stats" aria-label="Knowledge statistics">
      {statistics.map((statistic, index) => <StatisticCard key={statistic.id} statistic={statistic} index={index} />)}
    </section>
  );
}
