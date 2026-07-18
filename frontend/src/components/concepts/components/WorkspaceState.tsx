import { AlertTriangle, BrainCircuit, Network, RefreshCw } from "lucide-react";

interface WorkspaceStateProps {
  status: "loading" | "ready" | "error";
  isEmpty: boolean;
  errorMessage?: string;
  onRetry: () => void;
}

export default function WorkspaceState({ status, isEmpty, errorMessage, onRetry }: WorkspaceStateProps) {
  if (status === "ready" && !isEmpty) return null;

  if (status === "loading") {
    return (
      <div className="kw-workspace-state is-loading" role="status">
        <span className="kw-state-orb"><BrainCircuit size={25} /><i /></span>
        <h2>Connecting your knowledge</h2>
        <p>Loading concepts, resources, and relationships...</p>
        <div className="kw-state-skeleton"><i /><i /><i /><i /><i /></div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="kw-workspace-state is-error" role="alert">
        <span className="kw-state-orb"><AlertTriangle size={24} /></span>
        <h2>Knowledge workspace could not load</h2>
        <p>{errorMessage || "Check your connection and try again."}</p>
        <button type="button" onClick={onRetry}><RefreshCw size={14} /> Try again</button>
      </div>
    );
  }

  return (
    <div className="kw-workspace-state is-empty">
      <span className="kw-state-orb"><Network size={25} /></span>
      <h2>Your knowledge graph is ready to grow</h2>
      <p>Create a concept or connect a library resource to begin building your workspace.</p>
    </div>
  );
}

