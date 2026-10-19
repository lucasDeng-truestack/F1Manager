---
name: bootstrap-project
description: Lead-developer workflow for starting a brand-new project or app from scratch — discovery questions, docs-before-code (rules, brand, architecture), scaffold in dependency order, then per-feature loops via build-feature. Use when creating a new repo, a new app in a monorepo, or a greenfield product.
---

# Bootstrap Project — Greenfield Workflow

Building from scratch is the highest-ambiguity task an agent can get. The failure mode
is scaffolding for three hours against the wrong assumptions. So: **discovery → written
foundations → walking skeleton → features.** Code comes fourth, not first.

## Phase 1 — Discovery (ask, don't guess)

Ask the user these in one batch (skip any already answered by the request):

1. **Product:** who uses it, and what is the one workflow that must work in v1?
2. **Shape:** web app / API / mobile / monorepo combo? Multi-tenant or single-tenant?
3. **Stack:** any hard requirements? If none, propose the stack you know best from the
   owner's existing work (for this user: Next.js App Router + TypeScript + Tailwind +
   ShadCN on the front; Express + TypeScript + Prisma + Postgres on the back; pnpm
   workspaces monorepo; shared Zod contract package).
4. **Auth & roles:** who logs in, and what are the 2–3 permission levels?
5. **Branding:** existing brand assets, or should we write a neutral guide (dark/light,
   fonts, status-color-only policy) and iterate?
6. **Deployment target:** where will this run? (affects env/config layout from day one)
7. **Non-goals:** what is explicitly OUT of v1?

**Gate:** you can write a one-paragraph product description the user agrees with.

## Phase 2 — Foundations as documents (before any code)

Create these files first; they are what keeps every future agent session in sync:

1. `docs/architecture.md` — apps/packages layout, data flow, auth model, key decisions
   with one-line rationale each.
2. `docs/brand.md` — tokens (bg/surface/border/text for light+dark), fonts, type scale,
   status colors, component conventions, Do/Don't list. Model it on a strict "neutral
   chrome, color = meaning" system unless the user has a brand.
3. Agent rules (`.claude/rules/*.md` and/or `CLAUDE.md`):
   - `project-map.md`: what each app/package is, ports, commands.
   - `backend-rule.md`, `frontend-rule.md`: conventions, formatters, error model,
     response envelope, validation approach.
   - `git-workflow.md`: whether agents may commit (default: no).
4. `README.md` — how to install, run, and verify each app.

Show these to the user before scaffolding. Fixing a document costs one edit; fixing a
scaffolded assumption costs a rewrite.

## Phase 3 — Walking skeleton

Scaffold in dependency order, verifying each step runs before the next:

1. Repo + workspaces + TypeScript config + lint (`eslint` + `tsc --noEmit` wired into
   `lint` / `typecheck` / `test` scripts per package from day one).
2. Database schema for the core entities only + first migration.
3. Backend: app bootstrap, error handler middleware + error classes, response envelope
   helper, auth, one real module (route → service → DB) end to end.
4. Frontend: layout with theme provider (light+dark), auth pages, API client wrapper,
   one real page consuming the real module.
5. Seed script so the app demos with data.

**Gate:** one workflow works end to end — login → see real data → mutate it → see the
change. Nothing else exists yet. That's correct.

## Phase 4 — Features

From here, every feature goes through the `build-feature` skill (clarify → architect →
delegate → review loop → verify → handoff). Update `docs/architecture.md` and the rules
files whenever a decision changes them — stale rules are worse than no rules, because
agents obey them confidently.

## Anti-patterns

- Scaffolding every entity/CRUD up front ("it'll save time later" — it won't; half will
  be wrong after the first user demo).
- Adding a second module before the first one works end to end.
- Writing rules/docs "later." Later never comes, and every agent session re-derives —
  and re-guesses — the conventions.
- Copying this repo's code wholesale into an unrelated project; copy the *shape*
  (module boundaries, envelope, formatters, review loop), not the domain.
