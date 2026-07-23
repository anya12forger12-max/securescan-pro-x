# Accessibility Guide

Ensuring Malware Hash Checker Pro is usable by everyone, regardless of ability.

## Table of Contents

- [WCAG 2.2 AA Compliance](#wcag-22-aa-compliance)
- [Keyboard Navigation](#keyboard-navigation)
- [Screen Reader Support](#screen-reader-support)
- [Color Contrast](#color-contrast)
- [Reduced Motion](#reduced-motion)
- [Plain Language](#plain-language)
- [Testing Accessibility](#testing-accessibility)

---

## WCAG 2.2 AA Compliance

MHCP commits to **WCAG 2.2 Level AA** compliance. All contributions must meet these standards.

### Key Principles

1. **Perceivable** — Information and UI components must be presentable in ways all users can perceive.
2. **Operable** — UI components and navigation must be operable by all users.
3. **Understandable** — Information and UI operation must be understandable.
4. **Robust** — Content must be robust enough for diverse user agents and assistive technologies.

### Compliance Checklist

Every UI contribution must address:

- [ ] Keyboard navigability (all interactive elements)
- [ ] Screen reader compatibility (semantic labels and ARIA attributes)
- [ ] Color contrast (minimum 4.5:1 for normal text, 3:1 for large text)
- [ ] No color-only information (icons, text, or patterns supplement color)
- [ ] Reduced motion support (respects `prefers-reduced-motion`)
- [ ] Plain language (avoid jargon, use clear labels)
- [ ] Focus indicators (visible focus ring on all interactive elements)
- [ ] Error identification (errors described in text, not just color)
- [ ] Form labels (all inputs have associated labels)
- [ ] Heading hierarchy (proper h1-h6 nesting)

---

## Keyboard Navigation

### Tab Order

All interactive elements must be reachable via the `Tab` key in a logical order:

1. Navigation elements (menus, links)
2. Form inputs
3. Action buttons
4. Secondary controls

### Keyboard Shortcuts

| Action | Shortcut | Context |
|--------|----------|---------|
| Start scan | `Ctrl+Enter` | Scan dialog |
| Cancel scan | `Escape` | During scan |
| Toggle sidebar | `Ctrl+B` | Main window |
| Open settings | `Ctrl+,` | Global |
| Quit | `Ctrl+Q` | Global |

### Focus Management

```dart
// Flutter: Ensure focus traversal order
FocusTraversalGroup(
  child: Column(
    children: [
      TextField(focusNode: _firstFocus),
      ElevatedButton(focusNode: _secondFocus),
    ],
  ),
)
```

### Focus Indicators

All interactive elements must have visible focus indicators:

```dart
// Flutter: Custom focus decoration
ElevatedButton(
  style: ButtonStyle(
    side: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.focused)) {
        return const BorderSide(color: Colors.blue, width: 2);
      }
      return BorderSide.none;
    }),
  ),
  onPressed: () {},
  child: const Text('Scan'),
)
```

### No Keyboard Traps

Users must be able to navigate away from any component using standard keyboard shortcuts. Never trap focus without providing an escape mechanism.

---

## Screen Reader Support

### Semantic Labels

All interactive elements must have descriptive labels:

```dart
// Flutter: Accessible labels
IconButton(
  icon: const Icon(Icons.scan),
  tooltip: 'Start file scan',
  onPressed: _startScan,
)

Semantics(
  label: 'Scan result: malicious threat detected',
  child: const VerdictCard(verdict: VerdictType.KNOWN_MALICIOUS),
)
```

### ARIA Attributes

For web-based components, use appropriate ARIA roles:

- `role="status"` for progress updates
- `role="alert"` for important notifications
- `aria-label` for elements without visible text
- `aria-live="polite"` for dynamic content updates

### Live Regions

Announce dynamic content changes:

```dart
Semantics(
  liveRegion: true,
  child: Text(
    'Scan complete: 3 files scanned, 1 malicious threat found',
  ),
)
```

### Meaningful Text Alternatives

All images, icons, and visual elements must have text alternatives:

```dart
// Icons must have labels
Icon(
  Icons.warning,
  semanticLabel: 'Warning: potential threat detected',
)

// Charts must have data tables
Semantics(
  label: 'Scan results chart showing 70% clean, 20% unknown, 10% malicious',
  child: ScanResultsChart(data: results),
)
```

---

## Color Contrast

### Minimum Ratios

| Element | Minimum Ratio | Standard |
|---------|--------------|----------|
| Normal text (< 18pt) | 4.5:1 | WCAG AA |
| Large text (>= 18pt or 14pt bold) | 3:1 | WCAG AA |
| UI components | 3:1 | WCAG AA |
| Focus indicators | 3:1 | WCAG AA |

### Testing Contrast

Use automated tools to verify contrast:

```bash
# Flutter: Use the accessibility scanner
flutter test --accessibility
```

### Color-Only Information

Never rely solely on color to convey information. Supplement with:

- **Icons** — Use distinct icons alongside color coding
- **Text** — Add descriptive labels
- **Patterns** — Use patterns or shapes for charts
- **Bold/Underline** — Emphasize with text styling

```dart
// Incorrect — color only
Container(
  color: Colors.red,
  child: Text('Malicious'),
)

// Correct — color + icon + text
Row(
  children: [
    Icon(Icons.dangerous, color: Colors.red),
    Text('Malicious', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
  ],
)
```

### Theme Support

MHCP supports light mode, dark mode, and high contrast mode. Ensure all UI elements work correctly in all three:

```dart
// Respect system theme
MaterialApp(
  theme: ThemeData.light(),
  darkTheme: ThemeData.dark(),
  highContrastTheme: ThemeData(highContrast: true),
  themeMode: ThemeMode.system,
)
```

---

## Reduced Motion

### Respect User Preferences

The operating system's `prefers-reduced-motion` setting must be respected:

```dart
// Flutter: Check for reduced motion
class ReducedMotionWrapper extends StatelessWidget {
  final Widget child;

  const ReducedMotionWrapper({required this.child});

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    if (mediaQuery.disableAnimations) {
      return child; // No animations
    }
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      child: child,
    );
  }
}
```

### Animation Guidelines

| Animation Type | Reduced Motion Alternative |
|---------------|---------------------------|
| Fade in/out | Instant appearance |
| Slide transitions | Instant position change |
| Loading spinners | Static progress text |
| Progress bars | Percentage text only |
| Scale effects | No scaling |

### Scan Progress

During file scanning, provide a non-animated alternative:

```dart
// Animated version
LinearProgressIndicator(value: progress)

// Reduced motion version
Text('${(progress * 100).toInt()}% complete')
```

---

## Plain Language

### Writing Guidelines

- Use simple, direct sentences
- Avoid jargon and technical terms when possible
- Define necessary technical terms
- Use active voice
- Keep sentences short (under 20 words)

### Verdict Descriptions

| Verdict | Plain Language Description |
|---------|--------------------------|
| `KNOWN_MALICIOUS` | "This file matches a known threat. Do not open or execute this file." |
| `UNKNOWN` | "No information found about this file. Exercise caution." |
| `CLEAN` | "No known threats found for this file." |

### Error Messages

```dart
// Incorrect — technical jargon
"Hash computation failed: EACCES errno 13"

// Correct — plain language
"Cannot read file. Check that you have permission to access this file."
```

### Status Messages

```dart
// Incorrect — unclear
"Processing..."

// Correct — descriptive
"Computing SHA-256 hash for document.pdf..."
"Scanning 3 of 10 files..."
```

### Labels

```dart
// Incorrect — abbreviated
"Algo" "Src" "Sev"

// Correct — full labels
"Algorithm" "Source" "Severity"
```

---

## Testing Accessibility

### Automated Testing

Run accessibility checks as part of the test suite:

```bash
# Flutter accessibility tests
flutter test --accessibility

# Python accessibility marker
python -m pytest -m accessibility
```

### Manual Testing Checklist

Before submitting UI changes:

- [ ] Navigate the entire UI using only the keyboard
- [ ] Verify all interactive elements have visible focus indicators
- [ ] Test with a screen reader (VoiceOver on macOS, NVDA on Windows)
- [ ] Verify color contrast with a contrast checker tool
- [ ] Test with reduced motion enabled
- [ ] Test in high contrast mode
- [ ] Test with browser zoom at 200%
- [ ] Verify all images and icons have text alternatives
- [ ] Test error messages are announced by screen readers
- [ ] Verify form inputs have associated labels

### Screen Reader Testing

Test with at least one screen reader:

| Platform | Screen Reader |
|----------|--------------|
| macOS | VoiceOver (built-in) |
| Windows | NVDA (free) |
| Linux | Orca (built-in) |
| iOS | VoiceOver (built-in) |
| Android | TalkBack (built-in) |

### Contrast Checking Tools

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/)
- Chrome DevTools accessibility panel
- Firefox accessibility inspector

### Regression Prevention

Add accessibility tests for any new UI component:

```python
@pytest.mark.accessibility
def test_verdict_card_has_label() -> None:
    """VerdictCard has an accessible label."""
    card = VerdictCard(verdict=VerdictType.KNOWN_MALICIOUS)
    assert card.semanticsLabel == "Malicious threat detected"
```

---

## Resources

- [WCAG 2.2 Guidelines](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Flutter Accessibility Documentation](https://docs.flutter.dev/accessibility-and-localization/accessibility)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)
