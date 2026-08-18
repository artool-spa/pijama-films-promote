# Testing Guidelines

## Overview
Guidelines for testing in the Pijama Films platform using Vitest, React Testing Library, and Happy DOM.

## Test Structure

### File Organization
```
src/
  models/
    __tests__/
      film.test.ts
      campaign.test.ts
  components/
    __tests__/
      FilmCard.test.tsx
      CampaignCard.test.tsx
```

### Naming Convention
- Test files: `[name].test.ts` or `[name].test.tsx`
- Test names: Descriptive, readable sentences

## Model Tests

### Example Model Test
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

// Mock at the module boundary so the model's real logic runs.
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));

import { createFilm, getFilmById, updateFilm } from '../film';

describe('Film Model', () => {
  const producerId = 'producer-1';

  beforeEach(() => {
    db.reset();
  });

  it('should create a film', async () => {
    const filmData = {
      title: 'Test Film',
      description: 'A test film',
      duration: 120,
      year: 2024,
      genre: ['Drama'],
      director: 'Test Director',
    };

    const film = await createFilm(producerId, filmData);

    expect(film).toBeDefined();
    expect(film.title).toBe('Test Film');
    expect(film.producerId).toBe(producerId);
  });

  it('should get film by id', async () => {
    const created = await createFilm(producerId, { /* ... */ });
    const found = await getFilmById(created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it('should return null for non-existent film', async () => {
    const found = await getFilmById('non-existent-id');
    expect(found).toBeNull();
  });
});
```

## Component Tests

### Example Component Test
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FilmCard from '../FilmCard';

describe('FilmCard', () => {
  const mockFilm = {
    id: '1',
    title: 'Test Film',
    description: 'A test film',
    duration: 120,
    year: 2024,
    genre: ['Drama'],
    director: 'Test Director',
    posterUrl: 'https://example.com/poster.jpg',
    isPublished: true,
    producerId: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('renders film title', () => {
    render(<FilmCard film={mockFilm} />);
    expect(screen.getByText('Test Film')).toBeInTheDocument();
  });

  it('displays film duration', () => {
    render(<FilmCard film={mockFilm} />);
    expect(screen.getByText(/120/)).toBeInTheDocument();
  });
});
```

## API Route Tests

```typescript
import { describe, it, expect } from 'vitest';
import { GET, POST } from '../route';

describe('Films API', () => {
  it('GET should return all published films', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('POST should create a film with valid data', async () => {
    const request = new Request('http://localhost:3000/api/films', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Film',
        description: 'Description',
        duration: 120,
        year: 2024,
        genre: ['Drama'],
        director: 'Director',
      }),
    });

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.title).toBe('New Film');
  });

  it('POST should return 400 for invalid data', async () => {
    const request = new Request('http://localhost:3000/api/films', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }), // Invalid
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });
});
```

## Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with UI
yarn test:ui

# Run tests with coverage
yarn test:coverage
```

## Coverage Requirements

- **Models**: 80%+ coverage
- **API Routes**: 70%+ coverage
- **Components**: 60%+ coverage

## Testing Best Practices

1. **Arrange-Act-Assert Pattern**
```typescript
it('should do something', async () => {
  // Arrange: Setup test data
  const testData = { /* ... */ };

  // Act: Execute the function
  const result = await someFunction(testData);

  // Assert: Verify the result
  expect(result).toBe(expected);
});
```

2. **Descriptive Test Names**
```typescript
// ✅ Good
it('should return 404 when film does not exist', () => {});

// ❌ Bad
it('test 1', () => {});
```

3. **Test One Thing**
```typescript
// ✅ Good - focused test
it('should create a film', () => {});
it('should validate film title', () => {});

// ❌ Bad - testing multiple things
it('should create and update a film', () => {});
```

4. **Reset State Between Tests**
```typescript
beforeEach(() => {
  // The fake holds everything in memory; one call clears it.
  db.reset();
});
```

## Mocking

### Mock API Calls
```typescript
import { vi } from 'vitest';

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: 'mocked' }),
  } as Response)
);
```

### Mock Firestore
Prefer `FakeFirestore` (`src/test/firestore-fake.ts`) over hand-written mocks:
it stores documents, so assertions are about behaviour rather than about which
method was called.

```typescript
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));
```

## Key Rules
1. Write tests for all model functions
2. Test both success and error cases
3. Use descriptive test names
4. Clean up test data after each test
5. Aim for 70%+ code coverage
6. Test validation logic thoroughly
