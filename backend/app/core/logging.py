"""Structured logging configuration.

Uses structlog for structured, contextual logging with correlation IDs.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

# Module-level logger
_logger: structlog.stdlib.BoundLogger | None = None


def setup_logging(
    level: str = "info",
    json_output: bool = True,
) -> None:
    """Configure structured logging for the application.

    Args:
        level: Log level (debug, info, warning, error, critical).
        json_output: If True, output JSON; otherwise, human-readable.
    """
    global _logger

    log_level = getattr(logging, level.upper(), logging.INFO)

    # Shared processors
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if json_output:
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)

    # Suppress noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    _logger = structlog.get_logger("securescan")


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a bound logger instance.

    Args:
        name: Logger name (typically __name__).

    Returns:
        A structlog BoundLogger instance.
    """
    if _logger is None:
        setup_logging()
    return structlog.get_logger(name or "securescan")


def log_audit(
    action: str,
    user_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    **kwargs: Any,
) -> None:
    """Log an audit event.

    Args:
        action: The action performed (e.g., 'workspace.create').
        user_id: ID of the user performing the action.
        resource_type: Type of resource affected.
        resource_id: ID of resource affected.
        **kwargs: Additional context fields.
    """
    logger = get_logger("audit")
    logger.info(
        "audit.event",
        action=action,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        **kwargs,
    )


def log_security(
    event: str,
    severity: str = "info",
    **kwargs: Any,
) -> None:
    """Log a security event.

    Args:
        event: Security event description.
        severity: Event severity (info, warning, error, critical).
        **kwargs: Additional context fields.
    """
    logger = get_logger("security")
    log_fn = getattr(logger, severity, logger.info)
    log_fn("security.event", event=event, severity=severity, **kwargs)
