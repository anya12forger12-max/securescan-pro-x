"""Knowledge integration — links findings to contextual knowledge.

Provides interfaces for enriching findings with explanations, actions,
references, verification notes, learning resources, and glossary links.
This is a framework-only module; no external knowledge base is queried.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional


# ── Knowledge Entry ────────────────────────────────────────────────


class KnowledgeEntry:
    """A knowledge article linked to a finding or category.

    Provides contextual information to help users understand and remediate
    findings: explanations, actions, references, and learning resources.
    """

    def __init__(
        self,
        id: str,
        title: str,
        category: str,
        explanation: str = "",
        why_it_matters: str = "",
        suggested_actions: list[str] | None = None,
        references: list[str] | None = None,
        verification_notes: str = "",
        learning_resources: list[str] | None = None,
        glossary_links: dict[str, str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Initialize a knowledge entry.

        Args:
            id: Unique identifier.
            title: Article title.
            category: Knowledge category.
            explanation: What this means.
            why_it_matters: Why it's important.
            suggested_actions: Recommended remediation steps.
            references: External reference URLs.
            verification_notes: How to verify the finding.
            learning_resources: URLs to learning materials.
            glossary_links: Term → definition mapping.
            metadata: Additional metadata.
        """
        self.id = id
        self.title = title
        self.category = category
        self.explanation = explanation
        self.why_it_matters = why_it_matters
        self.suggested_actions = suggested_actions or []
        self.references = references or []
        self.verification_notes = verification_notes
        self.learning_resources = learning_resources or []
        self.glossary_links = glossary_links or {}
        self.metadata = metadata or {}

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary.

        Returns:
            Dictionary representation.
        """
        return {
            "id": self.id,
            "title": self.title,
            "category": self.category,
            "explanation": self.explanation,
            "why_it_matters": self.why_it_matters,
            "suggested_actions": self.suggested_actions,
            "references": self.references,
            "verification_notes": self.verification_notes,
            "learning_resources": self.learning_resources,
            "glossary_links": self.glossary_links,
            "metadata": self.metadata,
        }


# ── Knowledge Service Interface ──────────────────────────────────


class KnowledgeService(ABC):
    """Interface for knowledge integration operations."""

    @abstractmethod
    async def lookup_by_finding(
        self,
        finding_category: str,
        severity: str | None = None,
    ) -> list[KnowledgeEntry]:
        """Look up knowledge entries relevant to a finding.

        Args:
            finding_category: Finding category to look up.
            severity: Optional severity filter.

        Returns:
            List of relevant knowledge entries.
        """
        ...

    @abstractmethod
    async def lookup_by_category(
        self,
        category: str,
    ) -> list[KnowledgeEntry]:
        """Look up all knowledge entries in a category.

        Args:
            category: Knowledge category.

        Returns:
            List of knowledge entries.
        """
        ...

    @abstractmethod
    async def add_entry(
        self,
        entry: KnowledgeEntry,
    ) -> None:
        """Add a knowledge entry.

        Args:
            entry: Knowledge entry to add.
        """
        ...

    @abstractmethod
    async def search(
        self,
        query: str,
        limit: int = 20,
    ) -> list[KnowledgeEntry]:
        """Search knowledge entries by title and content.

        Args:
            query: Search query.
            limit: Maximum results.

        Returns:
            Matching knowledge entries.
        """
        ...

    @abstractmethod
    async def get_glossary_terms(self) -> dict[str, str]:
        """Get all glossary terms and definitions.

        Returns:
            Mapping of term → definition.
        """
        ...


# ── In-Memory Implementation ──────────────────────────────────────


class InMemoryKnowledgeService(KnowledgeService):
    """In-memory knowledge service with built-in entries."""

    def __init__(self) -> None:
        """Initialize with empty knowledge base."""
        self._entries: dict[str, KnowledgeEntry] = {}
        self._glossary: dict[str, str] = {}

    async def lookup_by_finding(
        self,
        finding_category: str,
        severity: str | None = None,
    ) -> list[KnowledgeEntry]:
        """Look up knowledge entries by finding category.

        Args:
            finding_category: Finding category.
            severity: Optional severity filter.

        Returns:
            Matching knowledge entries.
        """
        results = [
            e for e in self._entries.values()
            if e.category.lower() == finding_category.lower()
        ]
        if severity is not None:
            # Filter by metadata severity if present
            results = [
                e for e in results
                if e.metadata.get("severity") == severity or not e.metadata.get("severity")
            ]
        return results

    async def lookup_by_category(
        self,
        category: str,
    ) -> list[KnowledgeEntry]:
        """Look up all entries in a category.

        Args:
            category: Knowledge category.

        Returns:
            Matching entries.
        """
        return [
            e for e in self._entries.values()
            if e.category.lower() == category.lower()
        ]

    async def add_entry(
        self,
        entry: KnowledgeEntry,
    ) -> None:
        """Add a knowledge entry.

        Args:
            entry: Entry to add.
        """
        self._entries[entry.id] = entry
        # Auto-register glossary terms
        for term, definition in entry.glossary_links.items():
            self._glossary[term] = definition

    async def search(
        self,
        query: str,
        limit: int = 20,
    ) -> list[KnowledgeEntry]:
        """Search knowledge entries.

        Args:
            query: Search query.
            limit: Maximum results.

        Returns:
            Matching entries.
        """
        query_lower = query.lower()
        results = []
        for entry in self._entries.values():
            if (
                query_lower in entry.title.lower()
                or query_lower in entry.explanation.lower()
                or query_lower in entry.category.lower()
            ):
                results.append(entry)
                if len(results) >= limit:
                    break
        return results

    async def get_glossary_terms(self) -> dict[str, str]:
        """Get all glossary terms.

        Returns:
            Term → definition mapping.
        """
        return dict(self._glossary)
