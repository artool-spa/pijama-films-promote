# Instructions

## Context

This is a new project, a platform for advertising indie films of a new streaming service for rental of that films. The users are going to be producers of that films, they have little knowleadge of digital marketing in social media.


## Infraestructure
- Nextjs
- MUI library
- PrismaJs
- Postgresql

## Architecture Guidelines

- **MVC Pattern**: Follow MVC pattern where:
  - **Models**: Files in `/models` directory contain all database operations
  - **Controllers**: All server-side logic in `page.tsx` fetches data for client components
  - **Views**: Client components in `client.tsx` handle rendering and UI interactions
- **Database Access**:
  - Always use model functions, never use Prisma client directly in API routes
  - Server components (`page.tsx`) should import and use model functions directly, not call API routes
  - Client components should never access database directly
- **Error Handling**:
  - Handle 404 errors at the server level in page.tsx (controller)
  - Use Next.js notFound() for proper 404 responses
  - Don't pass nullable entities to client components


## Example project

This new project should be an upgraded version of this project /home/parga/workspace/andes

## Task

Create complete infraestructure, using yarn and docker compose as in *andes* using the latest version of libraries, implement https://github.com/diet103/claude-code-infrastructure-showcase with recomended agents, create an optimized version of CLAUDE.md

## Important

First understand own repo and then github repo, create an exhaustive implementation plan. Once accepted don't stop until finished 





