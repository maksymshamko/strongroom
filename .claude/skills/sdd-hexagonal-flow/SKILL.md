---
name: sdd-hexagonal-flow
description: Spec-driven development workflow (spec → test-by-spec → plan → verify-plan-against-spec → do → test → eval) combined with SOLID design and ports-and-adapters (hexagonal) layering. Use this whenever starting a new feature or service, writing a spec, writing tests before implementation, planning an implementation, reviewing whether a plan matches its spec, deciding where a piece of logic or a new dependency belongs (domain vs application vs infra), designing an interface/port for a database, queue, cache, or third-party API, or when asked to keep business logic independent of a specific database/framework/vendor so it can be swapped later. Trigger even for informal phrasing like "let's spec this out", "write the plan first", "where should this class live", or "how do I make this swappable".
---

# Spec-driven development + hexagonal layering

A project-agnostic method for moving a change from idea to shipped code
without the code and its own documentation quietly drifting apart, and for
keeping business logic independent of whatever database, queue, or
third-party API happens to sit behind it today.

Two things are bundled here because they reinforce each other: the gate
process keeps *what* gets built honest against a written spec; the
layering rules keep *where* it gets built honest, so that swapping
Postgres for Mongo, or one email provider for another, is a change in one
folder instead of a scavenger hunt through the whole codebase.

## Part 1 — The seven gates

Work moves through seven gates, in order. Each one produces an artefact
the next one is checked against. Skipping one is how a codebase starts
disagreeing with its own documentation.

| # | Gate | Artefact | Done when |
|---|------|----------|-----------|
| 1 | **Spec** | `specs/NNN.slug.md` | The behaviour is written down, including the parts that are decisions rather than requirements. Open questions are *listed*, not guessed at. |
| 2 | **Test by spec** | `test/**` | Tests are written **from the spec, before the implementation**, and they fail (red). Every spec section that states behaviour has a test that would break if it stopped being true. |
| 3 | **Plan** | `plans/NNN.slug.md` | Build order, contract decisions the spec left open, and a spec-section → test-file traceability table. |
| 4 | **Verify plan against spec** | — | Walk the spec and confirm each section appears in the plan's traceability table, and that every decision the plan invents is one the spec actually left open. Disagreements are resolved **in the spec**, never silently patched into the plan. |
| 5 | **Do** | code | Implement until the red tests are green. Never edit a test to make it pass — if a test looks wrong, that's a spec conversation, not a code fix. |
| 6 | **Test** | green suite | Everything green: unit, integration/e2e, and any cross-service contract suite. |
| 7 | **Eval** | eval / review report | For anything with a non-deterministic or quality-judged output (LLM prompts, ranking, generated content), run the real thing against real inputs and have a human read the samples. Assertions catch regressions; a human reading output is how quality is actually judged. Skip this gate entirely for purely deterministic systems where gate 6 already proves correctness. |

**Gate 4 is the one people drop.** It's the cheapest place to catch a plan
that has quietly redefined the product — treat it as its own explicit
step, not something folded silently into "writing the plan."

When picking up a task, first figure out which gate you're on (or about to
skip), and do that gate's job — don't jump ahead to code because it's
faster.

### Gate-by-gate guidance

**Gate 1 — Spec.** Write down what the system does, in numbered sections
(`§5.4`, `§10.1`, ...) — tests will cite these numbers, so the numbering
is load-bearing, not cosmetic. Explicitly list open questions rather than
resolving them with a silent assumption; an unresolved decision belongs in
the spec as a flagged question, not something decided later by whoever
writes the plan or the code.

**Gate 2 — Test by spec.** Tests are the executable spec: each one cites
the spec section it enforces (`// §5.4 entity map`). Write every test a
spec section implies **before** any implementation exists, and confirm
they fail for the right reason — the behaviour doesn't exist yet, not a
typo or broken harness. When a test and the implementation later
disagree, **the test is presumed right**. Changing a test afterwards is
only legitimate to fix a race, a wrong path, or a shape the spec never
pinned down — never to quietly lower a bar the spec set.

**Gate 3 — Plan.** Cover build order across every affected module/service.
Resolve contract decisions the spec explicitly left open (the plan may
*decide* those — it may not invent new ones). Build the spec-section →
test-file traceability table; it's the input to gate 4, so it needs to be
complete, not representative.

**Gate 4 — Verify plan against spec.** Do this as an explicit pass:
1. Walk the spec section by section.
2. Confirm each section appears somewhere in the plan's traceability
   table.
3. Confirm every decision the plan makes is one the spec actually left
   open — a plan deciding something the spec already answered (or never
   flagged as open) is a disagreement, not a plan detail.
4. Resolve any disagreement by editing the **spec**, never by quietly
   adjusting the plan to match what's easiest to build.

**Gate 5 — Do.** Implement until the red tests from gate 2 go green. If a
test seems wrong mid-implementation, stop and raise it as a spec
question instead of editing the test to unblock yourself.

**Gate 6 — Test.** Full suite green — unit, integration, contract tests
between services. If suites share stateful resources (a shared test
database/containers), consider whether they need to run serially rather
than in parallel; flaky "product bugs" that vanish under `--runInBand` (or
equivalent) are usually resource contention, not real bugs.

**Gate 7 — Eval.** For LLM prompts, ranking, or anything else judged on
quality rather than pass/fail: run against real inputs, budget for the
real cost (provider calls, compute), and read the sample output yourself
— a green assertion suite is not a substitute for a human reading the
actual output.

### Naming a spec and its plan

- Format: `NNN.slug.md`, identical in both `specs/` and `plans/`. A plan
  carries its spec's slug: `specs/008.thread-auto-naming.md` is planned in
  `plans/008.thread-auto-naming.md` — never `008.implementation-plan.md`
  (every plan is an implementation plan; that name just repeats what the
  directory already says).
- The slug is kebab-case and names the **change**, not the layer:
  `attachment-lifecycle`, not `backend-fixes`.
- Numbers come from one sequence shared by `specs/` and `plans/`, and are
  **never reused**, even for an abandoned spec.
- Before claiming a number: list both `specs/` and `plans/`, **and**
  `git branch -a` — a number claimed on an unmerged branch is not free
  just because it isn't merged yet. Parallel branches reaching for "the
  next free number" without seeing each other is exactly how duplicate
  numbers happen.
- If you inherit a duplicate number, leave it as-is. Renaming a spec
  breaks every `§n` citation in the tests that point at it.

---

## Part 2 — SOLID, applied

SOLID is a design lens, not a checklist to satisfy line-by-line — apply it
where it actually reduces coupling, and say so out loud when a rule is
being deliberately bent for a good reason.

- **Single Responsibility.** A class/module has one reason to change. If
  describing what a class does needs "and", it's a candidate to split.
  In this flow specifically: a service that both orchestrates a use case
  *and* knows SQL syntax has two reasons to change (a business rule, or a
  schema) — split it (see ports & adapters below).
- **Open/Closed.** Prefer adding a new implementation over editing an
  existing one to add a variant. A new `EmailNotifier` alongside
  `SmsNotifier` behind a shared `Notifier` port beats an `if channel ===
  'sms'` branch bolted onto an existing class.
- **Liskov Substitution.** Any adapter implementing a port must be
  swappable for another without the calling code noticing — no adapter
  should throw on inputs the port's contract allows, or silently narrow
  what the port promised. If a `PostgresUserRepository` and a
  `MongoUserRepository` don't behave identically for the same port
  method, the port is underspecified.
- **Interface Segregation.** Ports should be small and specific to what a
  consumer actually needs, not one fat `Repository` interface every
  adapter must implement in full. A `ReadOnlyCatalog` port and a
  `CatalogWriter` port beat one `CatalogRepository` with elevated
  read+write methods everyone must stub.
- **Dependency Inversion.** The application/domain layers define the
  interfaces (ports); infrastructure implements them. Domain code never
  imports a concrete driver — it depends on an abstraction it owns, and
  infra depends on that abstraction too, just from the other side. This
  is the principle the whole layering section below exists to enforce.

## Part 3 — Ports and adapters (hexagonal layering)

Goal: business logic doesn't know or care whether data lives in Postgres,
MongoDB, or a text file — swapping the database is a change confined to
`infra/`, not a change that ripples through every use case.

```
api/            interface layer only — controllers, HTTP/GraphQL/CLI, request
                parsing, auth guards, serialization. No business rules here.
application/    orchestration against ports; no framework, no driver. Coordinates
                domain objects and calls ports to get things done.
domain/         pure business logic — entities, value objects, domain rules.
                No I/O. No imports from application/, infra/, or any framework/
                driver package.
infra/          adapters — concrete implementations of ports: Postgres/Mongo
                repository, Redis cache, email provider client, message queue,
                third-party API client.
```

**Dependencies point inward only.** `api` depends on `application`;
`application` depends on `domain` and on port *interfaces*; `infra`
depends on `domain`/`application` (to implement their ports) — never the
reverse. `domain` depends on nothing outside itself.

### Where a port lives, and how a swap works

1. `application` (or `domain`, if the abstraction is truly business-level)
   defines an interface — the **port** — expressed in domain terms, not
   storage terms: `UserRepository.findByEmail(email)`, not
   `UserTable.selectWhere(...)`.
2. `infra` provides an **adapter**: `PostgresUserRepository implements
   UserRepository`. A second adapter, `MongoUserRepository implements
   UserRepository`, can exist alongside it or replace it — the
   application layer's code doesn't change either way, only which adapter
   gets wired up (typically at composition-root/DI time).
3. The application layer only ever sees the port's interface, injected —
   never the concrete adapter class, never a driver-specific type (no
   `pg.QueryResult`, no `mongoose.Document`) leaking into a method
   signature above `infra/`.

### A quick check that the boundary is holding

Adapt the driver/framework names to the actual stack, but the shape is
always the same — grep for driver imports in layers that shouldn't have
them:

```bash
# Example for a Node/TS + Postgres/Redis stack — adjust names to your stack
grep -rlE "pg|mongoose|drizzle-orm|ioredis" src/domain/       # must be empty
grep -rlE "pg|mongoose|drizzle-orm|ioredis" src/application/  # must be empty
grep -rlE "@nestjs|express" src/domain/                        # must be empty
```

If either check finds a hit, that's not a style nit — it's a spot where
"replace Postgres with Mongo" would stop being a one-folder change.

### Signs the boundary is already leaking

- A domain entity has a method or field that only makes sense for one
  storage engine (`toBsonDocument()`, `.rowVersion` used for optimistic
  locking logic that lives in `domain/` instead of the adapter).
- A use case in `application/` catches a driver-specific exception type
  (`UniqueConstraintViolationError` from an ORM) instead of a port-level
  error the adapter is responsible for translating.
- Business rules expressed as a query (a `WHERE` clause encoding "a
  discount only applies to orders over $50") instead of as domain logic
  that happens to be backed by a query for performance.
- A port interface has grown methods that exist only because one specific
  adapter's API shape needed them — that's the adapter's problem, not the
  port's.

### Applying this inside the gate flow

- **Gate 1 (spec):** describe behaviour in domain terms, not schema terms.
  "A user's email must be unique" is a spec sentence; "the `users` table
  has a unique index on `email`" is an implementation detail that belongs
  in the plan or the adapter, not the spec.
- **Gate 3 (plan):** when the plan proposes a new port, say so explicitly
  and name which layer defines it and which adapter(s) implement it —
  that's exactly the kind of "contract decision the spec left open" the
  gate-3 table should capture.
- **Gate 5 (do):** if implementing a use case tempts you to reach for a
  driver type inside `application/` or `domain/`, that's a signal the port
  is missing a method, not a reason to reach past it.
