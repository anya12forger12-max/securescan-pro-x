"""Unit tests for the in-memory vulnerability knowledge service."""

from __future__ import annotations

import pytest

from app.services.knowledge import InMemoryVulnKnowledgeService, VulnKnowledgeEntry


@pytest.fixture
def svc() -> InMemoryVulnKnowledgeService:
    return InMemoryVulnKnowledgeService()


class TestDefaults:
    async def test_defaults_loaded(self, svc: InMemoryVulnKnowledgeService) -> None:
        entries = await svc.get_all()
        assert len(entries) >= 10
        first = entries[0]
        data = first.to_dict()
        assert data["id"] == first.id
        assert data["title"] == first.title
        assert "remediation" in data
        assert "cwe_ids" in data

    async def test_xss_entry_present(self, svc: InMemoryVulnKnowledgeService) -> None:
        """The built-in XSS entry resolves through every lookup index."""
        hit = await svc.lookup_by_cwe("CWE-79")
        assert any(e.id == "kb-001" for e in hit)
        # Numeric form normalizes to the same entry.
        hit = await svc.lookup_by_cwe("79")
        assert any(e.id == "kb-001" for e in hit)
        cat = await svc.lookup_by_category("injection")
        assert any(e.id == "kb-001" for e in cat)
        owasp = await svc.lookup_by_owasp("A03:2021")
        assert any(e.id == "kb-001" for e in owasp)


class TestLookups:
    async def test_lookup_by_cwe_unknown(self, svc: InMemoryVulnKnowledgeService) -> None:
        assert await svc.lookup_by_cwe("CWE-999999") == []

    async def test_lookup_by_owasp_unknown(self, svc: InMemoryVulnKnowledgeService) -> None:
        assert await svc.lookup_by_owasp("A99:2099") == []

    async def test_lookup_by_category_case_insensitive(
        self,
        svc: InMemoryVulnKnowledgeService,
    ) -> None:
        entries = await svc.get_all()
        assert all(
            e.category.lower() == "injection" for e in await svc.lookup_by_category("INJECTION")
        )
        assert len(await svc.lookup_by_category("injection")) >= 1
        assert entries

    async def test_lookup_by_category_unknown(
        self,
        svc: InMemoryVulnKnowledgeService,
    ) -> None:
        assert await svc.lookup_by_category("no-such-category") == []

    async def test_search_by_category_keyword(
        self,
        svc: InMemoryVulnKnowledgeService,
    ) -> None:
        results = await svc.search("injection")
        assert results
        assert all(
            "injection" in e.title.lower()
            or "injection" in e.description.lower()
            or "injection" in e.category.lower()
            or any("injection" in t.lower() for t in e.tags)
            or any("injection" in c.lower() for c in e.cwe_ids)
            for e in results
        )

    async def test_search_respects_limit(self, svc: InMemoryVulnKnowledgeService) -> None:
        # Empty query matches every entry (substring of any string).
        results = await svc.search("", limit=5)
        assert len(results) == 5

    async def test_get_entry(self, svc: InMemoryVulnKnowledgeService) -> None:
        entries = await svc.get_all()
        assert await svc.get_entry(entries[0].id) == entries[0]
        assert await svc.get_entry("kb-nope") is None

    async def test_compliance_mappings(self, svc: InMemoryVulnKnowledgeService) -> None:
        owasp = await svc.get_compliance_mappings("owasp_top10")
        assert owasp
        assert any("kb-001" in ids for ids in owasp.values())
        for framework in ("nist", "cis", "bogus-framework"):
            mappings = await svc.get_compliance_mappings(framework)
            assert isinstance(mappings, dict)


class TestCustomEntries:
    async def test_add_entry_indexes_it(self, svc: InMemoryVulnKnowledgeService) -> None:
        entry = VulnKnowledgeEntry(
            id="custom-1",
            title="Custom Weakness",
            description="A bespoke issue for tests.",
            category="Custom",
            severity="high",
            cwe_ids=["CWE-42"],
            owasp_top10=["A01:2021-BrokenAccessControl"],
            tags=["custom"],
        )
        await svc.add_entry(entry)
        assert await svc.get_entry("custom-1") == entry
        assert any(e.id == "custom-1" for e in await svc.lookup_by_cwe("CWE-42"))
        assert any(e.id == "custom-1" for e in await svc.lookup_by_category("custom"))
        assert any(e.id == "custom-1" for e in await svc.lookup_by_owasp("A01:2021"))
        assert any(e.id == "custom-1" for e in await svc.search("bespoke"))

    async def test_empty_service(self) -> None:
        empty = InMemoryVulnKnowledgeService(include_defaults=False)
        assert await empty.get_all() == []
        assert await empty.lookup_by_cwe("CWE-79") == []
        assert await empty.search("xss") == []
