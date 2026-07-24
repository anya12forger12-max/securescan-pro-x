# Report Pipeline

## Overview

The report pipeline generates assessment reports in multiple formats. Reports are structured documents containing assessment metadata, findings, evidence, recommendations, and timeline information.

## Supported Formats

### JSON
Machine-readable structured data. Ideal for programmatic consumption and integration with other tools.

### Markdown
Human-readable documentation format. Ideal for wikis, documentation systems, and version control.

### HTML
Interactive web report with dark theme, severity badges, and responsive design. Ideal for stakeholder presentations and sharing.

### CSV
Spreadsheet-compatible format listing findings with key columns. Ideal for data analysis and filtering in spreadsheet applications.

## Report Structure

Every report contains these sections:

### Report Metadata
- Title
- Generated timestamp
- Generator tool and version
- Format

### Executive Summary
A natural-language summary of the assessment results including finding counts and severity distribution.

### Assessment Details
- Assessment ID, name, description
- Status and priority
- Target count
- Start and completion timestamps

### Severity Summary
Breakdown of findings by severity level:
- Critical
- High
- Medium
- Low
- Info

### Findings
Detailed list of all findings with:
- Title and severity
- Category
- Summary/description
- Recommendation
- Confidence score
- CVSS score and CWE IDs

### Evidence
List of evidence items with:
- Title and type
- Source and collector
- Classification level

### Timeline
Chronological list of assessment events.

### Appendix
Tool version and generation notes.

## Generating Reports

### Via API
```
POST /api/v1/assessments/{id}/reports
Content-Type: application/json

{
  "format": "html"
}
```

### Via Code
```python
from app.services.assessment.reports import (
    build_report_data,
    generate_html_report,
)

report_data = build_report_data(
    assessment=assessment,
    findings=findings,
    evidence=evidence,
)
html = generate_html_report(report_data)
```

## Report Content Guidelines

### Executive Summary
- State the assessment name and scope
- Report total finding count
- Highlight critical/high findings
- Provide severity distribution

### Findings
- Use clear, concise titles
- Include severity and confidence
- Provide actionable recommendations
- Reference evidence where applicable

### Evidence
- List all evidence items with source
- Note classification level
- Include integrity hash for verification

## Integrity

Each generated report includes an integrity hash (SHA-256) of the report content for tamper detection.

## Future Enhancements

- PDF generation with print-ready formatting
- Template-based report customization
- Multi-language report generation
- Automated report scheduling
- Report comparison across assessments
