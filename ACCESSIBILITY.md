# Accessibility Guide — SecureScan Pro X

## Standard

SecureScan Pro X targets **WCAG 2.2 AA** compliance across all user interfaces.

## Principles

### Perceivable

- All information and UI components must be presentable to users in ways they can perceive
- Text alternatives for non-text content
- Captions and alternatives for multimedia
- Content that can be presented in different ways without losing meaning

### Operable

- All UI components and navigation must be operable
- Full keyboard accessibility
- Users have enough time to read and use content
- Content does not cause seizures or physical reactions
- Users can easily navigate and find content

### Understandable

- Information and UI operation must be understandable
- Text is readable and understandable
- UI appears and operates in predictable ways
- Users are helped to avoid and correct mistakes

### Robust

- Content must be robust enough to be interpreted by assistive technologies
- Compatible with current and future tools

## Implementation Guidelines

### Keyboard Navigation

All interactive elements must be keyboard accessible:

```tsx
// Good: Keyboard accessible button
<button
  onClick={handleClick}
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
  tabIndex={0}
  role="button"
  aria-label="Create workspace"
>
  Create
</button>

// Good: Keyboard accessible card
<div
  role="button"
  tabIndex={0}
  onClick={handleSelect}
  onKeyDown={(e) => e.key === 'Enter' && handleSelect()}
  aria-label={`Select ${workspace.name}`}
>
  {workspace.name}
</div>
```

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| Tab | Move to next focusable element |
| Shift+Tab | Move to previous focusable element |
| Enter/Space | Activate button/link |
| Escape | Close dialog/modal |
| Arrow keys | Navigate within groups |
| Home/End | Navigate to first/last item |

### Focus Management

```css
/* Visible focus indicators */
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Remove default outline when using custom focus */
:focus:not(:focus-visible) {
  outline: none;
}
```

### Screen Reader Support

```tsx
// Use semantic HTML and ARIA attributes
<main role="main" aria-label="Assessment Dashboard">
  <h1>Dashboard</h1>
  <section aria-labelledby="recent-heading">
    <h2 id="recent-heading">Recent Assessments</h2>
    <ul role="list" aria-label="Recent assessments">
      {assessments.map(a => (
        <li key={a.id} role="listitem">
          <a href={`/assessments/${a.id}`}>{a.name}</a>
          <span aria-label={`Status: ${a.status}`}>
            <StatusBadge status={a.status} />
          </span>
        </li>
      ))}
    </ul>
  </section>
</main>
```

### Color and Contrast

| Element | Minimum Ratio |
|---|---|
| Normal text | 4.5:1 |
| Large text (18px+) | 3:1 |
| UI components | 3:1 |
| Focus indicators | 3:1 |

**Status indicators must not rely on color alone:**

```tsx
// Bad: Color only
<span style={{ color: 'red' }}>Critical</span>

// Good: Color + icon + text
<span className="status status--critical" aria-label="Critical severity">
  <Icon name="alert" aria-hidden="true" />
  Critical
</span>
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Scalable Text

All text uses relative units:

```css
:root {
  font-size: 16px; /* Base size */
}

body {
  font-size: 1rem; /* Scalable */
}

h1 {
  font-size: 2rem; /* Scales with user preference */
}

.small {
  font-size: 0.875rem; /* Minimum: 14px equivalent */
}
```

### Forms

```tsx
// Every input must have a label
<div className="form-group">
  <label htmlFor="workspace-name">
    Workspace Name
    <span className="required" aria-label="required">*</span>
  </label>
  <input
    id="workspace-name"
    type="text"
    required
    aria-required="true"
    aria-describedby="workspace-name-help"
    aria-invalid={hasError}
  />
  <span id="workspace-name-help" className="help-text">
    Choose a unique name for your workspace
  </span>
  {hasError && (
    <span role="alert" className="error">
      {errorMessage}
    </span>
  )}
</div>
```

### Tables

```tsx
<table aria-label="Assessment Results">
  <caption>Security assessment findings for Project X</caption>
  <thead>
    <tr>
      <th scope="col">Finding</th>
      <th scope="col">Severity</th>
      <th scope="col">Status</th>
    </tr>
  </thead>
  <tbody>
    {findings.map(f => (
      <tr key={f.id}>
        <td>{f.title}</td>
        <td>
          <StatusBadge status={f.severity} label={f.severity} />
        </td>
        <td>{f.status}</td>
      </tr>
    ))}
  </tbody>
</table>
```

### Dialogs

```tsx
<dialog
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-desc"
>
  <h2 id="dialog-title">Confirm Assessment</h2>
  <p id="dialog-desc">
    This will start a security assessment against the target.
  </p>
  <div className="dialog-actions">
    <button onClick={onCancel}>Cancel</button>
    <button onClick={onConfirm} autoFocus>Start Assessment</button>
  </div>
</dialog>
```

## Testing

### Automated Testing

```bash
# Run accessibility tests
pnpm test:a11y

# Check color contrast
pnpm test:contrast

# Verify keyboard navigation
pnpm test:keyboard
```

### Manual Testing Checklist

- [ ] All interactive elements reachable by keyboard
- [ ] Tab order is logical
- [ ] Focus indicator is visible
- [ ] Screen reader announces all content
- [ ] All images have alt text
- [ ] All forms have labels
- [ ] Error messages are announced
- [ ] No content flashes more than 3 times/second
- [ ] Text is readable at 200% zoom
- [ ] Color is not the only indicator
- [ ] Touch targets are at least 44x44px

## Design Tokens

### Accessibility-Specific Tokens

```css
:root {
  /* Focus */
  --focus-ring-color: #005fcc;
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;

  /* Text */
  --text-min-contrast: 4.5;
  --text-large-min-contrast: 3;
  --ui-min-contrast: 3;

  /* Spacing */
  --touch-target-min: 44px;
  --focus-offset: 2px;

  /* Motion */
  --animation-duration-default: 200ms;
  --animation-duration-reduced: 0ms;
}
```

## Common Issues

| Issue | Solution |
|---|---|
| Missing alt text | Add descriptive alt text to all images |
| No focus indicator | Use `:focus-visible` with visible outline |
| Color-only status | Add icon and text alongside color |
| Small touch targets | Ensure minimum 44x44px |
| Missing labels | Associate labels with form inputs |
| No heading hierarchy | Use h1-h6 in logical order |
| Auto-playing content | Provide controls and pause option |
