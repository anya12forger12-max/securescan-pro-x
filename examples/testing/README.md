# Testing Example — Writing Tests for MHCP

This directory demonstrates testing patterns used throughout the
Malware Hash Checker Pro codebase.

## Examples

### `conftest_example.py`

Reusable pytest fixtures for MHCP testing:
- In-memory database connections.
- Sample files with deterministic content.
- Pre-populated hash record databases.
- Pipeline configuration fixtures.

### `test_example.py`

Test suites covering:
- Unit tests for `HashAlgorithm` and `HashComputer`.
- `Result` type usage with `Ok`/`Err` monadic patterns.
- Database repository CRUD operations.
- Path safety validation.
- Scanner pipeline integration tests.
- Verdict generation edge cases.

```bash
# Run all tests
pytest conftest_example.py test_example.py -v

# Run with coverage
pytest conftest_example.py test_example.py --cov=mhcp_core --cov=mhcp_hashing --cov=mhcp_database -v
```

## Testing Conventions

| Marker        | Purpose                                   |
|---------------|-------------------------------------------|
| `@pytest.mark.unit` | Fast, isolated tests                  |
| `@pytest.mark.integration` | Multi-component interaction     |
| `@pytest.mark.e2e` | Full workflow validation              |
| `@pytest.mark.security` | Security regression tests           |
| `@pytest.mark.slow` | Tests taking > 5 seconds            |

## Setup

```bash
pip install -e ../..
pip install pytest pytest-cov pytest-mock hypothesis
```
