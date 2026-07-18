"""Generic registry that decouples workflows from tool implementations."""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import Any, Callable
from enum import Enum


ToolCallable = Callable[..., Any]


class ExecutionCost(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class RegisteredTool:
    name: str
    handler: ToolCallable
    description: str
    capabilities: tuple[str, ...] = ()
    prerequisites: tuple[str, ...] = ()
    expected_outputs: tuple[str, ...] = ()
    execution_cost: ExecutionCost = ExecutionCost.MEDIUM


class ToolRegistry:
    """Thread-safe runtime registry for built-in and future retrieval tools."""

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}
        self._lock = RLock()

    def register(
        self, name: str, handler: ToolCallable, description: str, *,
        capabilities: tuple[str, ...] = (), prerequisites: tuple[str, ...] = (),
        expected_outputs: tuple[str, ...] = (), execution_cost: ExecutionCost = ExecutionCost.MEDIUM,
        replace: bool = False,
    ) -> None:
        if not name.strip():
            raise ValueError("Tool name cannot be empty")
        with self._lock:
            if name in self._tools and not replace:
                raise ValueError(f"Tool is already registered: {name}")
            self._tools[name] = RegisteredTool(
                name=name, handler=handler, description=description,
                capabilities=capabilities, prerequisites=prerequisites,
                expected_outputs=expected_outputs, execution_cost=execution_cost,
            )

    def execute(self, name: str, *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"Unknown workflow tool: {name}")
        return tool.handler(*args, **kwargs)

    def contains(self, name: str) -> bool:
        with self._lock:
            return name in self._tools

    def available_tools(self) -> tuple[RegisteredTool, ...]:
        with self._lock:
            return tuple(self._tools.values())

    def tools_for_capability(self, capability: str) -> tuple[RegisteredTool, ...]:
        """Return capable tools ordered from lowest to highest declared cost."""

        order = {ExecutionCost.LOW: 0, ExecutionCost.MEDIUM: 1, ExecutionCost.HIGH: 2}
        matches = [tool for tool in self.available_tools() if capability in tool.capabilities]
        return tuple(sorted(matches, key=lambda tool: (order[tool.execution_cost], tool.name)))

    def descriptor(self, name: str) -> RegisteredTool:
        with self._lock:
            tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"Unknown workflow tool: {name}")
        return tool
