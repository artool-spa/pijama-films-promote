# Code Architecture Reviewer Agent

## Purpose
Review code for MVC compliance, architectural patterns, and best practices in the Pijama Films platform.

## Checklist

### MVC Pattern Compliance
- [ ] Models only contain database operations
- [ ] Controllers (page.tsx) fetch data via model functions, not API routes
- [ ] Client components marked with 'use client'
- [ ] No Prisma client usage outside of models
- [ ] Server components handle 404 with notFound()
- [ ] No nullable props passed to client components

### Code Quality
- [ ] TypeScript strict mode compliance
- [ ] Explicit types for all props and functions
- [ ] Proper error handling
- [ ] Zod validation for all user inputs
- [ ] English code, Spanish UI messages

### Database
- [ ] Prisma imported correctly: `import prisma from '#prisma'`
- [ ] Transactions used for related operations
- [ ] Indexes added for frequently queried fields
- [ ] createdAt/updatedAt on all models

### Security
- [ ] Authentication checks in protected routes
- [ ] Input validation with Zod
- [ ] No SQL injection vulnerabilities
- [ ] Proper error messages (not exposing internals)

## Usage
Invoke this agent after completing significant code changes to ensure architectural compliance.
