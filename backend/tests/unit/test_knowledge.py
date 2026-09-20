"""Unit tests for the knowledge integration service.

Tests cover knowledge entry management, search, and glossary functionality.
"""

from __future__ import annotations

import pytest

from app.services.assessment.knowledge import (
    InMemoryKnowledgeService,
    KnowledgeEntry,
)


class TestKnowledgeService:
    """Tests for InMemoryKnowledgeService."""

    @pytest.fixture
    def service(self) -> InMemoryKnowledgeService:
        """Create a fresh service."""
        return InMemoryKnowledgeService()

    @pytest.mark.asyncio
    async def test_add_and_lookup_by_category(
        self, service: InMemoryKnowledgeService
    ) -> None:
        """Adding and looking up by category works."""
        entry = KnowledgeEntry(
            id="k1",
            title="SQL Injection Prevention",
            category="web_security",
            explanation="SQL injection occurs when...",
            suggested_actions=["Use parameterized queries"],
        )
        await service.add_entry(entry)

        results = await service.lookup_by_category("web_security")
        assert len(results) == 1
        assert results[0].title == "SQL Injection Prevention"

    @pytest.mark.asyncio
    async def test_lookup_by_finding(
        self, service: InMemoryKnowledgeService
    ) -> None:
        """Looking up by finding category works."""
        entry = KnowledgeEntry(
            id="k2",
            title="Weak Password Policy",
            category="authentication",
            explanation="Weak passwords are easily guessed...",
        )
        await service.add_entry(entry)

        results = await service.lookup_by_finding("authentication")
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_search(self, service: InMemoryKnowledgeService) -> None:
        """Searching entries works."""
        await service.add_entry(KnowledgeEntry(
            id="k1", title="SQL Injection", category="web",
        ))
        await service.add_entry(KnowledgeEntry(
            id="k2", title="XSS Prevention", category="web",
        ))
        await service.add_entry(KnowledgeEntry(
            id="k3", title="Password Policy", category="auth",
        ))

        results = await service.search("injection")
        assert len(results) == 1
        assert results[0].id == "k1"

    @pytest.mark.asyncio
    async def test_search_by_content(
        self, service: InMemoryKnowledgeService
    ) -> None:
        """Searching by explanation content works."""
        await service.add_entry(KnowledgeEntry(
            id="k1",
            title="Firewall",
            category="network",
            explanation="A firewall monitors network traffic",
        ))
        results = await service.search("network traffic")
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_glossary(self, service: InMemoryKnowledgeService) -> None:
        """Glossary terms are collected from entries."""
        await service.add_entry(KnowledgeEntry(
            id="k1",
            title="CWE",
            category="reference",
            glossary_links={
                "CWE": "Common Weakness Enumeration",
                "CVE": "Common Vulnerabilities and Exposures",
            },
        ))
        terms = await service.get_glossary_terms()
        assert terms["CWE"] == "Common Weakness Enumeration"
        assert terms["CVE"] == "Common Vulnerabilities and Exposures"

    @pytest.mark.asyncio
    async def test_entry_to_dict(self) -> None:
        """KnowledgeEntry serializes to dict."""
        entry = KnowledgeEntry(
            id="k1",
            title="Test",
            category="test",
            explanation="Test explanation",
        )
        d = entry.to_dict()
        assert d["id"] == "k1"
        assert d["title"] == "Test"
        assert d["explanation"] == "Test explanation"

    @pytest.mark.asyncio
    async def test_search_limit(self, service: InMemoryKnowledgeService) -> None:
        """Search respects the limit parameter."""
        for i in range(10):
            await service.add_entry(KnowledgeEntry(
                id=f"k{i}", title="Common Term", category="test",
            ))
        results = await service.search("common", limit=3)
        assert len(results) == 3
