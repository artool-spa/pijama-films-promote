# Rethinkg data

## Context

We have several sources of information, so we have some options create a syncronized architecture, store minimal and core information or some hybrid. Right now I want to reimplement some parts of the MVP becuase I understan better the problem.

## Information sources

1. MUVI CMS - completed
2. Pijama in house system (contains the relation of the user, producer company and films), also contains information about the movie. This is not integrated yet. more information in (prompts/2026-01/Sesion dashboard pijama.md)
3. Ad Servers, right now only meta

## Definitions

- Internal information should be following: internal campaign, relation between meta adsets and campaigns, relation between producer and meta campaign
- Minimal meta information: no stats 

## user - producer - film relation

In Inhouse system producer have films and also users

## Temporal hack for in house integration

There will be only a few user as for producer named "PijamaFilms" that have access to all movies and its own campaigns. Even though it's a hack in reality it could stay because the owner of PijamaFilms may wan't to promote a movie they want.

## GOAL

Propuse an architecture








