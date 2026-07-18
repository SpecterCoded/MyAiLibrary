"""Small workflow inspection helpers kept separate from execution."""

from .workflow_models import EdgeCondition, RetrievalWorkflow, WorkflowStep


def enabled_tool_names(workflow: RetrievalWorkflow) -> tuple[str, ...]:
    """Return enabled tools in dependency order for logging and diagnostics."""

    return tuple(step.tool_name for step in workflow.steps if step.enabled)


def eligible_successors(
    workflow: RetrievalWorkflow, node_id: str, condition: EdgeCondition,
) -> tuple[WorkflowStep, ...]:
    """Resolve enabled successor nodes for a runtime edge condition."""

    edges = [
        edge for edge in workflow.outgoing(node_id)
        if edge.condition in {condition, EdgeCondition.ALWAYS}
    ]
    return tuple(workflow.node(edge.target) for edge in edges if workflow.node(edge.target).enabled)
