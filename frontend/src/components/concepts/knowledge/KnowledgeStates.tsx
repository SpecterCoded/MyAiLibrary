import { BrainCircuit, CircleCheck, Sparkles } from "lucide-react";

const STAGES = ["Reading transcript", "Analyzing chapters", "Extracting concepts", "Detecting relationships", "Building graph", "Preparing visualization"];

export function KnowledgeLoading({ activeStage }: { activeStage: number }) {
  return (
    <section className="kx-state" aria-live="polite">
      <span className="kx-state-orb"><BrainCircuit size={27} /><i /></span>
      <span className="kx-eyebrow"><Sparkles size={12} /> Building lesson intelligence</span>
      <h2>Your knowledge graph is taking shape</h2>
      <p>We are preparing the interactive explorer and connecting the lesson's most important ideas.</p>
      <div className="kx-processing-stages">{STAGES.map((stage, index) => <span key={stage} className={index <= activeStage ? "is-complete" : ""}><CircleCheck size={14} />{stage}</span>)}</div>
      <div className="kx-state-skeleton"><i /><i /><i /><i /><i /><i /></div>
    </section>
  );
}

export function KnowledgeEmptyState({ onGenerate, onLearnMore }: { onGenerate: () => void; onLearnMore: () => void }) {
  return (
    <section className="kx-state">
      <span className="kx-empty-illustration"><i /><i /><i /><BrainCircuit size={33} /></span>
      <span className="kx-eyebrow"><Sparkles size={12} /> Ready when you are</span>
      <h2>No Knowledge Graph has been generated for this lesson yet.</h2>
      <p>Generate an interactive map of concepts, relationships, teaching order, and learning signals.</p>
      <div><button type="button" className="kx-button kx-button-primary" onClick={onGenerate}>Generate Knowledge Graph</button><button type="button" className="kx-button" onClick={onLearnMore}>Learn more</button></div>
    </section>
  );
}
