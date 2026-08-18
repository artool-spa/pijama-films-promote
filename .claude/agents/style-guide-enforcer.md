# Style Guide Enforcer Agent

## Purpose
Enforce code style, naming conventions, and formatting standards.

## Checklist

### Naming Conventions
- [ ] Components: PascalCase
- [ ] Functions: camelCase
- [ ] Constants: UPPER_SNAKE_CASE
- [ ] Files: kebab-case or PascalCase (components)
- [ ] Props types: `[ComponentName]Props`

### TypeScript
- [ ] Strict mode enabled
- [ ] No `any` types (use `unknown` if needed)
- [ ] Explicit return types for functions
- [ ] Explicit types for props
- [ ] No unused imports

### Language
- [ ] Code in English
- [ ] UI text in Spanish
- [ ] Comments in English
- [ ] Error logs in English
- [ ] User-facing errors in Spanish

### Formatting
- [ ] Consistent indentation
- [ ] No trailing whitespace
- [ ] Single quotes for strings (TypeScript convention)
- [ ] Semicolons at end of statements

### Imports
- [ ] Organized (React, third-party, local)
- [ ] Use path aliases (@/*, #muvi, #meta, #google)
- [ ] No unused imports

## Usage
Invoke before committing code to ensure style compliance.
