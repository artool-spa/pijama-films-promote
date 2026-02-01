# Refactor campaigns workflow

## Context

Util now, we where using just one campaign for parten objective. Each campaign has multiple languages, but with meta restriction we need to reformulate.

## Meta Restrictions

Dynamic creative can't be multilanguage and only 1 media type

## New structure

- Each campaign has it own meta campaign with budget in campaign
- A Campaign can only have 1 language
- It has 1 or 2 Adsets depending if it has videos and/or images all sharing budget

## Task

Create a plan with all needed changes 