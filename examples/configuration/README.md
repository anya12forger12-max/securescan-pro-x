# Configuration Example — Managing MHCP Configuration

This directory demonstrates how to load, validate, and persist
configuration for Malware Hash Checker Pro.

## Examples

### `sample_config.yaml`

A complete reference configuration file with every recognised key
documented.

### `config_manager.py`

Shows how to use `ConfigurationManager` to:
- Load configuration from TOML files.
- Apply environment variable overrides.
- Validate against a schema.
- Retrieve and set values with dot-separated paths.
- Save configuration to disk.

```bash
python config_manager.py
```

## Configuration Sources (Priority Order)

1. **Built-in defaults** — `DEFAULT_CONFIG` in `mhcp_config.defaults`.
2. **TOML files** — one or more files loaded via `manager.load()`.
3. **Environment variables** — prefixed with `MCP_`, e.g.
   `MCP_LOGGING__LEVEL=DEBUG`.
4. **Programmatic overrides** — via `manager.set()`.

Later sources override earlier ones.

## Setup

```bash
pip install -e ../..
```
