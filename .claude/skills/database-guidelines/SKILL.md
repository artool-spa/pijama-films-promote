# Database Guidelines

## Overview
Guidelines for working with Prisma ORM and PostgreSQL in the Pijama Films platform.

## Prisma Client Access

### Singleton Pattern
**✅ CORRECT:**
```typescript
import prisma from '#prisma';

export async function getFilmById(id: string) {
  return await prisma.film.findUnique({ where: { id } });
}
```

**❌ WRONG:**
```typescript
import { prisma } from '#prisma'; // ❌ No destructuring
import { PrismaClient } from '@prisma/client'; // ❌ Don't create instances
const prisma = new PrismaClient(); // ❌ Multiple instances
```

## Schema Design

### Best Practices
1. Use `@id @default(cuid())` for IDs
2. Include `createdAt` and `updatedAt` timestamps
3. Use appropriate field types (`@db.Text` for long strings)
4. Define proper relationships with `@relation`
5. Use enums for fixed value sets

### Example Schema
```prisma
model Producer {
  id        String   @id @default(cuid())
  email     String   @unique
  saltHash  String
  films     Film[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Film {
  id          String   @id @default(cuid())
  title       String
  producerId  String
  producer    Producer @relation(fields: [producerId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Migrations

### Creating Migrations
```bash
# Generate Prisma client after schema changes
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name add_campaign_model

# Apply migrations in production
npx prisma migrate deploy
```

### Migration Workflow
1. Modify `schema.prisma`
2. Run `prisma generate`
3. Run `prisma migrate dev --name descriptive_name`
4. Test the migration locally
5. Commit schema.prisma and migration files

## Query Patterns

### Basic Queries
```typescript
// Find unique
const film = await prisma.film.findUnique({
  where: { id: filmId },
});

// Find many with filters
const films = await prisma.film.findMany({
  where: {
    isPublished: true,
    year: { gte: 2020 },
  },
  orderBy: { createdAt: 'desc' },
  take: 10,
});

// Count
const count = await prisma.film.count({
  where: { isPublished: true },
});
```

### Relations
```typescript
// Include related data
const film = await prisma.film.findUnique({
  where: { id: filmId },
  include: {
    producer: true,
    campaigns: {
      where: { isActive: true },
      include: { metrics: true },
    },
  },
});

// Select specific fields
const films = await prisma.film.findMany({
  select: {
    id: true,
    title: true,
    producer: {
      select: {
        firstName: true,
        lastName: true,
      },
    },
  },
});
```

### Create/Update/Delete
```typescript
// Create
const film = await prisma.film.create({
  data: {
    title: 'Mi Película',
    description: 'Una gran película',
    duration: 120,
    year: 2024,
    genre: ['Drama'],
    director: 'Director',
    producerId: producerId,
  },
});

// Update
const updated = await prisma.film.update({
  where: { id: filmId },
  data: { isPublished: true },
});

// Delete
await prisma.film.delete({
  where: { id: filmId },
});
```

## Transactions

### When to Use
- Multiple related operations
- Operations that must succeed/fail together
- Data consistency requirements

```typescript
const result = await prisma.$transaction(async (tx) => {
  const campaign = await tx.campaign.create({
    data: {
      name: campaignName,
      budget: budget,
      filmId: filmId,
    },
  });

  await tx.campaignMetric.create({
    data: {
      campaignId: campaign.id,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0,
    },
  });

  return campaign;
});
```

## Aggregations

```typescript
// Count, sum, avg, min, max
const stats = await prisma.campaign.aggregate({
  where: { isActive: true },
  _count: true,
  _sum: { budget: true, spend: true },
  _avg: { budget: true },
});

// Group by
const campaignsByFilm = await prisma.campaign.groupBy({
  by: ['filmId'],
  _count: true,
  _sum: { budget: true },
});
```

## Performance Optimization

### Use Select When Possible
```typescript
// ✅ Better - only fetch needed fields
const films = await prisma.film.findMany({
  select: { id: true, title: true, posterUrl: true },
});

// ❌ Fetches all fields
const films = await prisma.film.findMany();
```

### Pagination
```typescript
// Cursor-based pagination
const films = await prisma.film.findMany({
  take: 20,
  skip: 1,
  cursor: { id: lastFilmId },
  orderBy: { createdAt: 'desc' },
});

// Offset pagination
const films = await prisma.film.findMany({
  skip: page * pageSize,
  take: pageSize,
});
```

### Indexes
Add indexes in schema for frequently queried fields:
```prisma
model Film {
  id          String   @id @default(cuid())
  producerId  String
  isPublished Boolean

  @@index([producerId])
  @@index([isPublished, createdAt])
}
```

## Error Handling

```typescript
import { Prisma } from '@prisma/client';

try {
  const film = await prisma.film.create({ data });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      // Unique constraint violation
      throw new Error('A film with this title already exists');
    }
  }
  throw error;
}
```

## Key Rules
1. Always import: `import prisma from '#prisma'`
2. Never create new PrismaClient instances
3. Use transactions for related operations
4. Include createdAt/updatedAt on all models
5. Add indexes for frequently queried fields
6. Use select to limit fields when possible
