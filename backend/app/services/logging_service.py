"""Logging service — structured logging with correlation IDs.

Wraps structlog for application-wide logging with context propagation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import structlog


class LoggingService(ABC):
    """Interface for logging operations."""

    @abstractmethod
    def get_logger(self, name: str) -> Any:
        """Get a named logger instance.

        Args:
            name: Logger name (typically module name).

        Returns:
            A bound logger instance.
        """
        ...

    @abstractmethod
    def set_context(self, **kwargs: Any) -> None:
        """Set context variables for all subsequent log entries.

        Args:
            **kwargs: Context key-value pairs.
        """
        ...

    @abstractmethod
    def clear_context(self) -> None:
        """Clear all context variables."""
        ...


class StructuredLoggingService(LoggingService):
    """Implementation using structlog for structured logging."""

    def get_logger(self, name: str) -> Any:
        """Get a named structlog logger.

        Args:
            name: Logger name.

        Returns:
            A structlog BoundLogger.
        """
        return structlog.get_logger(name)

    def set_context(self, **kwargs: Any) -> None:
        """Set structlog context variables.

        Args:
            **kwargs: Context key-value pairs.
        """
        for key, value in kwargs.items():
            structlog.contextvars.bind_contextvars(**{key: value})

    def clear_context(self) -> None:
        """Clear all structlog context variables."""
        structlog.contextvars.clear_contextvars()
