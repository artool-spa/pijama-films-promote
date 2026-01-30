# Film Platform Domain Guidelines

## Overview
Domain-specific guidelines for the Pijama Films platform, covering film advertising concepts, campaign management, and producer workflows.

## Core Entities

### Producer
- Independent film producers with limited digital marketing knowledge
- Manage their own films and campaigns
- Need simple, intuitive interfaces
- Primary language: Spanish

### Film
- **Title**: Film name
- **Description**: Synopsis for marketing
- **Duration**: Runtime in minutes
- **Year**: Release year
- **Genre**: Array of genres (Drama, Comedia, Documental, etc.)
- **Director**: Director name
- **Poster**: Image URL for promotional materials
- **Trailer**: Video URL for preview
- **Rental URL**: Link to streaming service
- **Published**: Whether film is live on platform

### Campaign
- Marketing campaign for a specific film
- **Name**: Campaign identifier
- **Budget**: Total budget allocated
- **Start/End Date**: Campaign duration
- **Active**: Whether campaign is running
- **Metrics**: Performance data

### Campaign Metrics
- **Impressions**: Number of views
- **Clicks**: Number of clicks
- **Conversions**: Number of rentals/purchases
- **Spend**: Money spent
- **Date**: Metric date for tracking

## Business Rules

### Film Management
1. Producers can only edit their own films
2. Films must be published to appear in catalog
3. Unpublished films are visible only to owner
4. All films require poster and trailer before publishing

### Campaign Management
1. Campaigns must be linked to a published film
2. Budget cannot be negative
3. End date must be after start date (if set)
4. Active campaigns consume budget daily
5. Metrics are recorded daily

### Metrics Calculation
```typescript
// Calculate campaign ROI
const roi = ((conversions * avgRentalPrice) - spend) / spend * 100;

// Calculate click-through rate
const ctr = (clicks / impressions) * 100;

// Calculate conversion rate
const conversionRate = (conversions / clicks) * 100;
```

## User Workflows

### Film Creation Flow
1. Producer fills film details form
2. Upload poster image
3. Add trailer URL
4. Save as draft (unpublished)
5. Review and publish

### Campaign Creation Flow
1. Select published film
2. Set campaign name and budget
3. Choose start/end dates
4. Activate campaign
5. Monitor metrics daily

### Analytics Dashboard
1. View all active campaigns
2. See aggregate metrics
3. Compare campaign performance
4. Identify top-performing films

## Spanish Terminology

| English | Spanish |
|---------|---------|
| Producer | Productor |
| Film | Película |
| Campaign | Campaña |
| Budget | Presupuesto |
| Metrics | Métricas |
| Impressions | Impresiones |
| Clicks | Clics |
| Conversions | Conversiones |
| Published | Publicado |
| Draft | Borrador |
| Dashboard | Panel de Control |
| Analytics | Analíticas |

## Validation Rules

### Film Validation
```typescript
const FilmSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(10).max(2000),
  duration: z.number().int().positive().max(500),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 2),
  genre: z.array(z.string()).min(1).max(5),
  director: z.string().min(1).max(200),
  posterUrl: z.string().url().optional(),
  trailerUrl: z.string().url().optional(),
  rentalUrl: z.string().url().optional(),
});
```

### Campaign Validation
```typescript
const CampaignSchema = z.object({
  name: z.string().min(1).max(100),
  budget: z.number().positive().max(1000000),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  filmId: z.string().cuid(),
}).refine(data => !data.endDate || data.endDate > data.startDate, {
  message: 'La fecha de fin debe ser posterior a la fecha de inicio',
  path: ['endDate'],
});
```

## UI/UX Guidelines

### Simplicity First
- Producers have limited tech experience
- Use clear, simple language
- Minimize steps in workflows
- Provide helpful tooltips and guidance

### Visual Hierarchy
- Films as main focus (large poster images)
- Metrics displayed prominently
- Clear call-to-action buttons

### Feedback
- Show success messages after actions
- Display loading states during operations
- Provide error messages in Spanish
- Use validation feedback on forms

## Key Rules
1. All user-facing text in Spanish
2. Producers can only manage their own content
3. Films must be published to create campaigns
4. Metrics are read-only (updated by system)
5. Budget validation before campaign activation
