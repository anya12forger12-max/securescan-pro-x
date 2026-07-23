# Dependency Diagram

> Package dependency graph, external dependencies, and dev dependencies.

---

## 1. Internal Package Dependency Graph

```
                              +============+
                              | mhcp-core  |
                              | (no deps)  |
                              +=====+======+
                                    |
              +---------+-----------+-----------+---------+
              |         |           |           |         |
              v         v           v           v         v
      +-------+---+ +--+--------+ +--+------+ +--+------+ +--------+
      |mhcp-      | |mhcp-     | |mhcp-    | |mhcp-    | |mhcp-   |
      |hashing    | |security  | |logging  | |config   | |reports |
      |           | |           | | (no     | | (no     | |        |
      |dep: core  | |dep: core  | | ext dep)| | ext dep)| |dep:core|
      +-----+-----+ +-----+----+ +---------+ +---------+ +----+---+
            |              |                                    |
            |              |                                    |
            v              v                                    |
      +-----+--------------+------------------------------------+---+
      |                                                                |
      |                      mhcp-scanner                              |
      |                                                                |
      |  deps: core, hashing, (optional: database, security)          |
      +-----+------------------------------------------+--------------+
            |                                          |
            v                                          v
      +-----+--------+                        +--------+-------+
      |mhcp-database  |                        |mhcp-ui        |
      |                |                        |                |
      |dep: core       |                        | (placeholder)  |
      +----------------+                        +----------------+
```

### Dependency Rules (Enforced)

| Rule | Description |
|---|---|
| R1 | `mhcp-core` has zero dependencies |
| R2 | Infrastructure packages depend only on `mhcp-core` |
| R3 | `mhcp-scanner` is the only package that bridges domain and infrastructure |
| R4 | No circular dependencies allowed |
| R5 | All dependencies flow inward toward `mhcp-core` |

---

## 2. Package Dependency Matrix

| Package | core | hashing | scanner | database | security | logging | config | reports | ui |
|---|---|---|---|---|---|---|---|---|---|
| **core** | - | | | | | | | | |
| **hashing** | YES | - | | | | | | | |
| **scanner** | YES | YES | - | opt | opt | | | | |
| **database** | YES | | | - | | | | | |
| **security** | YES | | | | - | | | | |
| **logging** | | | | | | - | | | |
| **config** | | | | | | | - | | |
| **reports** | YES | | | | | | | - | |
| **ui** | | | | | | | | | - |

Legend: **YES** = required dependency, **opt** = optional dependency, blank = no dependency

---

## 3. External Dependencies

### Runtime Dependencies (by package)

#### `mhcp-core`
| Dependency | Version | Purpose |
|---|---|---|
| *(none)* | — | Zero external dependencies |

#### `mhcp-hashing`
| Dependency | Version | Purpose |
|---|---|---|
| `mhcp-core` | >=0.1.0 | Error types and Result monad |

#### `mhcp-scanner`
| Dependency | Version | Purpose |
|---|---|---|
| `mhcp-core` | >=0.1.0 | Error types and Result monad |
| `mhcp-hashing` | >=0.1.0 | Hash algorithm and computation |

#### `mhcp-database`
| Dependency | Version | Purpose |
|---|---|---|
| `mhcp-core` | >=0.1.0 | Error types and Result monad |
| `sqlite3` | (stdlib) | SQLite database driver |

#### `mhcp-security`
| Dependency | Version | Purpose |
|---|---|---|
| `mhcp-core` | >=0.1.0 | Error types and Result monad |
| `pathlib` | (stdlib) | Path manipulation |
| `os` | (stdlib) | File permission checks |

#### `mhcp-logging`
| Dependency | Version | Purpose |
|---|---|---|
| *(none)* | — | Uses only stdlib `logging` |
| `logging` | (stdlib) | Python logging framework |

#### `mhcp-config`
| Dependency | Version | Purpose |
|---|---|---|
| *(none)* | — | Uses only stdlib modules |
| `tomllib` | (stdlib 3.11+) | TOML file parsing |
| `json` | (stdlib) | JSON serialization |

#### `mhcp-reports`
| Dependency | Version | Purpose |
|---|---|---|
| `mhcp-core` | >=0.1.0 | Error types and Result monad |
| `json` | (stdlib) | JSON report generation |
| `csv` | (stdlib) | CSV report generation |
| `xml` | (stdlib) | XML report generation |

#### `mhcp-ui`
| Dependency | Version | Purpose |
|---|---|---|
| *(none)* | — | Python placeholder package |

---

## 4. Dev Dependencies (by package)

| Package | Dev Dependency | Version | Purpose |
|---|---|---|---|
| `mhcp-core` | `pytest` | >=7.0 | Test runner |
| `mhcp-core` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-hashing` | `pytest` | >=7.0 | Test runner |
| `mhcp-hashing` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-scanner` | `pytest` | >=7.0 | Test runner |
| `mhcp-scanner` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-database` | `pytest` | >=7.0 | Test runner |
| `mhcp-database` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-security` | `pytest` | >=7.0 | Test runner |
| `mhcp-security` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-logging` | `pytest` | >=7.0 | Test runner |
| `mhcp-logging` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-config` | `pytest` | >=7.0 | Test runner |
| `mhcp-config` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-reports` | `pytest` | >=7.0 | Test runner |
| `mhcp-reports` | `pytest-cov` | >=4.0 | Coverage reporting |
| `mhcp-ui` | `pytest` | >=7.0 | Test runner |

### Project-Wide Dev Dependencies

| Tool | Version | Purpose |
|---|---|---|
| `ruff` | latest | Linting and formatting |
| `mypy` | latest | Static type checking |
| `pre-commit` | latest | Git hook management |
| `hatch` | latest | Build system |

---

## 5. Standard Library Usage

The project heavily leverages Python's standard library to minimize external dependencies:

| stdlib Module | Used By | Purpose |
|---|---|---|
| `hashlib` | hashing, scanner | Cryptographic hash computation |
| `sqlite3` | database | SQLite database driver |
| `logging` | logging | Structured logging framework |
| `tomllib` | config | TOML file parsing (3.11+) |
| `json` | config, reports | JSON serialization |
| `csv` | reports | CSV report generation |
| `xml.etree` | reports | XML report generation |
| `pathlib` | all packages | OS-agnostic path handling |
| `os` | security, config | File operations, env vars |
| `uuid` | scanner | Session/scan ID generation |
| `datetime` | scanner, database | Timestamp handling |
| `threading` | scanner | Thread-safe cancellation |
| `abc` | hashing | Abstract base classes |
| `enum` | all packages | Enumeration types |
| `dataclasses` | all packages | Data class definitions |
| `typing` | all packages | Type hint support |
| `functools` | various | Function utilities |
| `math` | scanner | Shannon entropy calculation |

---

## 6. Build System Dependencies

```
pyproject.toml (per package)
  |
  +-- build-system
  |     requires = ["hatchling"]
  |     build-backend = "hatchling.build"
  |
  +-- project
  |     name = "mhcp-<package>"
  |     version = "0.1.0"
  |     requires-python = ">=3.10"
  |     dependencies = [...]
  |
  +-- project.optional-dependencies
  |     dev = ["pytest>=7.0", "pytest-cov>=4.0"]
  |
  +-- tool.hatch.build.targets.wheel
  |     packages = ["lib/src"]
  |
  +-- tool.hatch.build.targets.sdist
  |     include = ["lib/src", "tests"]
  |
  +-- tool.pytest.ini_options
        testpaths = ["tests"]
```

---

## 7. Dependency Flow Visualization

```
                        External Consumers
                              |
                              v
+===========================================================+
|                     mhcp-ui (Flutter)                      |
|                     mhcp-ui (Python)                        |
+==========================+==================================+
                           |
                     IPC / FFI
                           |
+==========================v==================================+
|                     mhcp-scanner                             |
|  - Pipeline orchestration                                    |
|  - State machine management                                  |
|  - Scheduler and session tracking                            |
+---+---------------------+---------------------+------------+
    |                     |                     |
    v                     v                     v
+---+------+  +-----------+-------+  +---------+--------+
|mhcp-     |  |mhcp-database      |  |mhcp-security     |
|hashing   |  |                    |  |                   |
|          |  | SQLite + WAL       |  | Path safety       |
| Algorithm|  | Models + Repo      |  | Permissions       |
| Backend  |  |                    |  | Signatures        |
+----+-----+  +--------+----------+  +---------+---------+
     |                  |                       |
     v                  v                       v
+===========================================================+
|                        mhcp-core                           |
|                                                            |
|  MHCError hierarchy    Result[T,E]    Severity enum        |
|  (errors.py)           (result.py)    (errors.py)          |
+===========================================================+
     |                       |
     v                       v
+---------+           +-----------+
|mhcp-    |           |mhcp-      |
|logging  |           |config     |
|         |           |           |
| Logger  |           | Manager   |
| PII     |           | Schema    |
+---------+           +-----------+
     |                       |
     +-----------+-----------+
                 |
                 v
         stdlib only
         (no external deps)
```
