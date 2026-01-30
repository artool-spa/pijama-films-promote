# film-feature

Generate a complete feature implementation following the MVC pattern for the film platform.

## Purpose
Scaffold a new feature with all required files following project architecture.

## Generates

### 1. Model (src/models/[feature].ts)
- Zod schema for validation
- Type definitions
- CRUD functions
- Complex queries

### 2. API Routes (src/app/api/[feature]/)
- route.ts with GET, POST
- [id]/route.ts with GET, PUT, DELETE
- Authentication checks
- Zod validation
- Error handling

### 3. Server Component (src/app/[feature]/page.tsx)
- Data fetching via model functions
- 404 handling with notFound()
- Props passing to client

### 4. Client Component (src/app/[feature]/client.tsx)
- MUI components
- User interactions
- Form handling
- Spanish UI text

### 5. Tests (src/models/__tests__/[feature].test.ts)
- Model function tests
- Validation tests
- Edge case coverage

## Usage
```
/film-feature campaign-template
```

Creates campaign template feature with:
- src/models/campaignTemplate.ts
- src/app/api/campaign-templates/route.ts
- src/app/campaign-templates/page.tsx
- src/app/campaign-templates/client.tsx
- src/models/__tests__/campaignTemplate.test.ts

## Follows
- MVC architecture pattern
- Backend/frontend dev guidelines
- Film platform domain rules
- Testing standards
