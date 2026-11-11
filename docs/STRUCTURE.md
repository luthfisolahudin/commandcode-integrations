> Implementation note: §2 and §7 below are the shipped layout. Older sections of this document still use the working names (`core`, `hosts`) from the analysis that led here.

# Design: package layering, agent skills, and agent instructions

Companion to `DESIGN.md` (engine), `TEMPLATE.md` (sync), `APPROACHES.md`
(mono/multi). This document redesigns the inside of a provider repo: how the
packages are cut, which agent skills are worth shipping, and how `AGENTS.md` and
`CLAUDE.md` are structured.

Status: proposal.

---

## 1. Why the 4-package cut was still muddy

The previous proposal was `core / provider / pi / opencode`. Each of those
directories had more than one reason to change:

| Package | Reasons it changes | Test strategy needed |
|---|---|---|
| `core` | vendor-neutral rules **and** network/fs I/O **and** reporting | pure unit + mocked fs/fetch — three styles in one package |
| `provider` | vendor **facts** (limits, invariants, effort measurements) **and** pack **behaviour** (hooks) | fixtures + a live probe — and no rule stopped it from growing logic |
| `pi` / `opencode` | host API **and** model-visibility policy (which models are enabled, how availability maps) | projection + host stubs |
| `scripts/` (root) | outside the workspace, so it needed its own `tsconfig` (the exact wart `commandcode-integrations` has with `tsconfig.scripts.json`) | none |

Two rules were missing, and without them "packages" is only a folder convention:

1. **A package may not import a package from an outer layer.**
2. **Each fact has exactly one home**, chosen by *why it changes*, not by where it
   is convenient.

## 2. The cut: facts, policy, mechanics, adapters

Four words that decide where any line of code goes:

| Word | Meaning | Changes when | Package |
|---|---|---|---|
| **facts** | vendor-specific data and measurements | the vendor changed | `provider` |
| **policy** | vendor-neutral rules and contracts | *we* changed our mind | `contract` |
| **mechanics** | I/O that applies policy to facts | network/fs/what we cache | `catalog` |
| **adapters** | translation into a host's API | OpenCode/Pi changed | `pi`, `opencode` |

Applied to the real ambiguities:

| Fact | Home | Why |
|---|---|---|
| `displayName("cbcn/kimi-k3")` | contract | pure naming policy, no vendor data |
| brand/owner overrides for CosmosHub ids | provider | vendor data |
| `thinkingFormat` enum + how Pi maps it | contract | policy |
| which model declares `thinkingFormat: "kimi"` | provider | vendor data |
| measured wire effort for `gpt-6.1-terra` | provider | measurement |
| "unmeasured models get no effort menu" | contract | policy |
| availability filter (`status: offline`) | catalog | mechanics: applies policy to live data |
| cache TTL, ETag, atomic write | catalog | mechanics |
| effort-probe sampling protocol | cli + skill | mechanics you run, not data |
| fixture files | provider | vendor snapshots |
| conformance suite | conformance | cross-cutting verification, dev-only |

### Package graph

```
packages/                       engine + tools (no host SDK peers)
  contract/      @<scope>/<repo>-contract      zero deps, zero I/O, zero node builtins
                 record, pack (definePack + validation + packSchemaVersion),
                 capabilities, naming, thinking, limits policy, effort policy,
                 provenance types
  catalog/       @<scope>/<repo>-catalog       depends: contract
                 envelope parse, discover (fetch), cache (fs), provenance
                 assembly, availability filter, refresh orchestration
  provider/      @<scope>/<repo>-provider      depends: contract        [repo-owned]
                 pack.ts (wire + hooks), curated, invariants,
                 effort (measurements), fallback, fixtures
  cli/           @<scope>/<repo>-cli           depends: contract, catalog, provider
                 bin: provider-check, provider-probe, provider-report,
                 provider-doctor, provider-init, provider-sync, provider-boundaries
  conformance/   @<scope>/<repo>-conformance   dev-only, depends on everything, and the only
                 package allowed to import adapters
adapters/                       harness entrypoints (peer-dep on a host SDK)
  pi/            pi-provider-<id>    depends: contract, catalog, provider
  opencode/      opencode-provider-<id>
```

Top-level vocabulary, one rule per directory:

| Directory | Rule |
|---|---|
| `packages/` | library or tool; may not take a host SDK as a peer |
| `adapters/` | the thing a harness loads by path |
| `examples/` | corpus for conformance; deleted downstream |
| `docs/`, `.agents/`, `.claude/`, `.github/` | prose, agent surface, CI |

### Import matrix (enforced)

| from \ may import | contract | catalog | provider | pi | opencode | cli | conformance |
|---|---|---|---|---|---|---|---|
| `contract` | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `catalog` | ✓ | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| `provider` | ✓ | ✗ | — | ✗ | ✗ | ✗ | ✗ |
| `pi` | ✓ | ✓ | ✓ | — | ✗ | ✗ | ✗ |
| `opencode` | ✓ | ✓ | ✓ | ✗ | — | ✗ | ✗ |
| `cli` | ✓ | ✓ | ✓ | ✗ | ✗ | — | ✗ |
| `conformance` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

Enforced three ways, cheapest first:

1. **pnpm workspace deps.** An undeclared import fails resolution, so the arrow
   has to be written down in `package.json` before it can exist.
2. **`provider-boundaries`** (`packages/cli`): scans every source file's import
   specifiers and fails on a disallowed pair. ~60 lines, zero dependencies, runs
   in `task check` and CI.
3. **Layer review rule** for agents: see `AGENTS.md`.

Note what the matrix deliberately forbids:

- `cli` may **not** import a host. Reporting is about normalized records;
  anything that needs a host projection belongs to `conformance`.
- `catalog` may **not** import `provider`. Discovery takes a `Pack` argument, it
  does not reach for one.
- `provider` may **not** import `catalog`. If a vendor needs a bespoke HTTP call,
  that is a `hooks.discover` implementation receiving a context object **typed in
  `contract`**, so the vendor file never touches our I/O layer.

That last rule is the one that keeps `packages/provider` from becoming a dumping
ground: a hook can *describe* what it needs, but it cannot *own* network or cache
behaviour. Those stay in `catalog`, where both hosts benefit.

### Why each merge/split is justified

- **`contract` vs `catalog`**: pure rules are testable with no mocking; I/O is
  testable with one mock. Mixing them means every rules test drags a fake `fs`.
- **`provider` separate from `contract`**: it is the only repo-owned package.
  Keeping facts out of the engine is what makes template sync conflict-free.
- **`pi` vs `opencode` separate**: different peer dependencies and different
  API churn. A single `hosts` package would force both peers on every consumer.
- **`cli` as a package, not root scripts**: removes the extra `tsconfig`, gives
  `pnpm exec provider-check`, and makes the dependency declare itself.
- **`conformance` separate**: it is the only package allowed to know about both
  hosts and the corpus. Root `test/` would silently become a fifth layer.

Leaner variant, if 7 packages feels heavy: fold `cli` back into root scripts and
`conformance` into `test/`. You lose (2) and (4) only. Recommendation: keep 7;
the two extra packages are under 300 lines each and they are where the "did we
cross a boundary" answer lives.

## 3. Agent skills: what is worth shipping

### The division of labour

| Channel | Holds | Budget |
|---|---|---|
| `AGENTS.md` | always-true invariants, commands, map | target < 200 lines, loaded every session |
| `docs/*.md` | rationale, evidence, design | unbounded, read on demand |
| **skills** | **decisions + commands + failure modes for one recurring job** | one screen each, loaded only when routed |

Rule: a skill may **not** restate a doc. It must add the part a doc cannot carry
— *when to stop*, *what never to do*, *which command sequence*, *how to tell you
got it wrong*. If a skill can be replaced by "run `task check`", it should not
exist.

### Decision test

Ship a skill only if all four hold:

1. the job recurs (more than once a quarter, or once per new provider);
2. it has a decision tree a naive agent gets wrong;
3. the correct procedure is stable (won't churn monthly);
4. failure is expensive but detectable.

### The three skills

**`probe-provider`** — measure thinking/effort behaviour of one model.

- Applies when: a reasoning model has no measured effort, a new id appears in the
  catalog, a route started rejecting `reasoning_effort`, or a model's thinking
  output looks unchanged across levels.
- Encodes: 3 samples per level, 32-token probes, one model at a time (aggregators
  fail over between upstreams); accept matrix (HTTP 400 = unsupported, 200 =
  accepted); the **no-observable-difference rule** (ship no effort menu rather
  than pick a winner from noise); the inversion case (higher level producing less
  thinking); the evidence line format for `docs/EVIDENCE.md` (date, command,
  status, `reasoning_tokens`, `finish_reason`); and the invariant that the effort
  table is never edited without that line.
- References: `docs/THINKING.md`, `packages/cli` probe commands.

**`sync-template`** — take a new template tag safely.

- Applies when: the template published a tag, or `provider-doctor` reports the
  pack schema is older than the engine expects.
- Encodes: clean-tree precondition, `task sync:template VERSION=x.y.z`, which
  paths resolve to *ours* (`owned[]`) and which to *theirs*, the modify/delete
  rule for `examples/**`, the ban on hand-resolving conflicts inside
  `packages/{contract,catalog,pi,opencode}`, and the rule for a bumped
  `packSchemaVersion` (run the migration before committing).
- Failure modes: two template versions merged at once (forbidden — each tag is a
  separate merge); `template.lock.json` edited by hand (forbidden).

**`add-provider`** — go from "new vendor" to "green repo".

- Applies when: onboarding a vendor, or adding a second endpoint to an existing
  repo.
- Encodes: `provider-init` → capture one real payload into
  `packages/provider/fixtures/` → declare `fields` aliases → write invariants
  from **vendor docs, not the catalog** → run `task check:catalog` → probe effort
  → wire the two install paths (`adapters/pi/src/index.ts`,
  `adapters/opencode/src/index.ts`) → document in `docs/EVIDENCE.md`.
- Encodes the anti-patterns: no regex-based capability guessing, no limits
  invented when the vendor page is silent, no `status: offline` models silently
  dropped from the *report* (only from the picker).

**Not shipped, deliberately:** `host-api-migration` (OpenCode/Pi contract
changes). It is rare, and until it happens once we do not know the procedure.
Write it after the first migration — with the real steps — not before.

### Where skills live

Verified discovery on the three harnesses in use:

| Harness | Project skill path | Reads `.agents/skills/` |
|---|---|---|
| Pi | `.agents/skills/` (walked up to repo root) | yes, natively |
| OpenCode | `.opencode/skills/` | yes, as a compatibility source |
| Claude Code | `.claude/skills/` | no |

So: canonical skills live in `.agents/skills/<name>/SKILL.md`, and
`.claude/skills` is a **directory symlink** to `../.agents/skills`. One authoring
location, three harnesses, no copies. Verified on this Windows machine: a
directory symlink commits as mode `120000` and resolves after clone.

### Keeping skills true

`packages/conformance/test/skills.test.ts` (already the house pattern —
`9router-integrations` has `test/docs.test.ts`):

- frontmatter parses, `name` matches the directory, `description` ≤ 1024 chars
  and contains a routing trigger;
- every `task <name>` mentioned in a skill exists in `Taskfile.yaml`;
- every path mentioned in backticks exists in the repo;
- no absolute paths, no secrets, no `~` paths.

That converts "skills rot" from a vague risk into a red CI run.

## 4. `AGENTS.md` + `CLAUDE.md`

### Verified loading behaviour

| Harness | Files | Scope |
|---|---|---|
| Pi | `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` | agent dir + every ancestor of cwd |
| OpenCode | `AGENTS.md` | cwd up to project root |
| Claude Code | `CLAUDE.md`, `@path` imports; `AGENTS.md` only when no `CLAUDE.md` exists | project + subdirectories |

Consequence: **one canonical `AGENTS.md` at the repo root, and `CLAUDE.md` as a
symlink to it.** No nested per-package `AGENTS.md` files, because Pi and OpenCode
already walk ancestors: an agent working in `packages/provider` sees the root
file. Adding six nested files plus six symlinks buys nothing and adds six places
to drift.

`AGENTS.md` is **template-owned** (it must improve across all repos at once). The
repo-specific escape hatch is a single stable line at the bottom — "Vendor notes:
read `docs/REPO.md`" — where `docs/REPO.md` is repo-owned. That line never
changes, so it never conflicts.

### Content plan (150–180 lines)

1. **What this repo is** — one paragraph: live model discovery + OpenAI Chat
   Completions for Pi and OpenCode; membership is discovered, never typed.
2. **Read first** — `docs/DESIGN.md`, `docs/SYNC.md`, `docs/EVIDENCE.md`,
   `docs/REPO.md`.
3. **Package map + layer rules** — the facts/policy/mechanics/adapters table and
   the import matrix, compressed to ~20 lines. This is the highest-value section:
   it is what stops an agent from putting a `fetch` call inside `provider`.
4. **Commands** — `task check`, `task check:catalog`, `task probe:effort`,
   `task sync:template`, `task doctor`, `task report`. Nothing else.
5. **Hard invariants** — never invent a capability or an effort; unmeasured means
   no menu; generated files (`docs/PROVIDERS.md`) are never edited by hand; no
   keys or auth headers in fixtures; `template.lock.json` is never hand-edited;
   the public surface of `contract` changes only with a `packSchemaVersion` bump.
6. **Change protocol** — fixture first, then invariants, then projection test,
   then code; run `task check` before claiming done; append evidence lines with
   date + command + observed signature.
7. **Agent boundaries** — what needs a human decision: a template version bump, a
   `packSchemaVersion` bump, deleting a provider's fallback entry, choosing an
   effort mapping when the probe is ambiguous.
8. **Vendor notes pointer** — `docs/REPO.md`.

Cross-platform `.gitattributes` is part of this: `* text=auto eol=lf` plus
`*.md text eol=lf`, so both machines produce identical diffs and symlinks stay
intact.

### `doctor` checks the pair

`provider-doctor` (and CI on both operating systems) asserts, per repo:

- `git ls-files -s CLAUDE.md` is mode `120000` and its target is `AGENTS.md`;
- `.claude/skills` is mode `120000` and resolves to a directory;
- `AGENTS.md` exists, is under the line budget, and contains the required
  sections (a heading match, not a prose match);
- every skill passes the conformance checks in §3;
- `packages/provider` has `pack.ts`, `fixtures/`, and `docs/EVIDENCE.md`;
- `template.lock.json` parses and its `version` is not older than the pack
  schema requires.

A clone on Windows without symlink privilege writes `CLAUDE.md` as a text file
containing `AGENTS.md`. `doctor` catches that in one run instead of letting
Claude Code quietly read a one-line file. Documented fix:
`git config core.symlinks true` plus Developer Mode, or clone via `thunk`.

## 5. What this changes in the earlier docs

- `TEMPLATE.md` §2.1 package list is superseded by §2 here (`contract`,
  `catalog`, `provider`, `pi`, `opencode`, `cli`, `conformance`).
- `TEMPLATE.md` ownership table gains `.agents/skills/**`, `.claude/skills`,
  `AGENTS.md`, `CLAUDE.md`, `.gitattributes` as template-owned, and
  `docs/REPO.md` as repo-owned.
- `DESIGN.md` §7 module list maps into `contract` (policy) and `catalog`
  (mechanics); no behavioural change, only placement.

## 6. Open questions

1. Package name: `contract` (recommended) vs `core` vs `policy`.
2. 7 packages (recommended) or the leaner 5 (`cli` as root scripts, conformance
   as root `test/`)?
3. Skills: three now (`probe-provider`, `sync-template`, `add-provider`) or only
   the two that cannot be recovered from docs (`probe-provider`,
   `sync-template`)?
4. `docs/REPO.md` as the per-repo escape hatch — or accept manual conflict
   resolution on `AGENTS.md` instead?
5. Should the public template ship the same `AGENTS.md`, or a shorter one for
   outsiders? (Recommend identical: one file to maintain, and it teaches the
   layer rules to anyone who clones.)

---

## 7. Final layout (decided)

Decisions applied: `contract` naming, 7 packages, 3 skills, `docs/REPO.md`
escape hatch, same `AGENTS.md` in template and downstream. `scripts/` is gone —
`Taskfile.yaml` calls package bins directly, which removes the extra `tsconfig`
for good.

### 7.1 Template repo: `ai-provider-integrations-template` (public)

```
ai-provider-integrations-template/
├─ AGENTS.md                            # ~170 lines, loaded by Pi/OpenCode/Claude
├─ CLAUDE.md → AGENTS.md                # symlink (mode 120000)
├─ .claude/
│  └─ skills → ../.agents/skills        # symlink (mode 120000)
├─ .agents/skills/
│  ├─ add-provider/SKILL.md
│  ├─ probe-provider/SKILL.md
│  └─ sync-template/SKILL.md
├─ .gitattributes                       # * text=auto eol=lf; *.md text eol=lf
├─ .gitignore  .editorconfig  .node-version
├─ .github/workflows/check.yaml         # ubuntu + windows, pinned SHAs
├─ package.json                         # private, type: module, scripts → pnpm -r
├─ pnpm-workspace.yaml                  # packages/* + adapters/* + examples/*
├─ tsconfig.json  tsconfig.base.json
├─ mise.toml  Taskfile.yaml  renovate.json
├─ LICENSE  README.md  SECURITY.md  CONTRIBUTING.md  TEMPLATE.md
├─ docs/
│  ├─ DESIGN.md                         # engine: three questions, ladders
│  ├─ STRUCTURE.md                      # this document
│  ├─ SYNC.md                           # template merge + ownership manifest
│  ├─ ADDING-A-PROVIDER.md              # the long form of the add-provider skill
│  └─ THINKING.md                       # format mapping table + evidence format
├─ packages/
│  ├─ contract/                         # @<scope>/<repo>-contract — policy, zero I/O
│  │  ├─ package.json  tsconfig.json
│  │  ├─ src/
│  │  │  ├─ record.ts                   # NormalizedModel, Provenance, Source
│  │  │  ├─ pack.ts                     # Pack type, definePack(), validation,
│  │  │  │                              #   packSchemaVersion
│  │  │  ├─ capabilities.ts             # capabilityView(), strict === true reads
│  │  │  ├─ naming.ts                   # displayName() policy, brand/owner rules
│  │  │  ├─ thinking.ts                 # ThinkingFormat enum + host mapping policy
│  │  │  ├─ limits.ts                   # resolution ladder policy + defaults
│  │  │  ├─ effort.ts                   # level list, wire effort type,
│  │  │  │                              #   "unmeasured ⇒ no menu" policy
│  │  │  └─ probe.ts                    # probe plan/result types
│  │  └─ test/                          # pure unit tests, no mocks at all
│  │     ├─ capabilities.test.ts  naming.test.ts  pack.test.ts
│  │     └─ thinking.test.ts  limits.test.ts  effort.test.ts
│  ├─ catalog/                          # @<scope>/<repo>-catalog — mechanics
│  │  ├─ package.json  tsconfig.json
│  │  ├─ src/
│  │  │  ├─ parse.ts                    # data[] / models[] / array / single
│  │  │  ├─ discover.ts                 # fetch + hooks + timeout + ETag
│  │  │  ├─ cache.ts                    # snapshot, atomic write, TTL, OS paths
│  │  │  ├─ provenance.ts               # facts + ladder → NormalizedModel[]
│  │  │  ├─ availability.ts             # status/non-chat filtering
│  │  │  └─ refresh.ts                  # cache-first → network → publish
│  │  └─ test/                          # mocked fetch/fs only
│  │     ├─ parse.test.ts  cache.test.ts  provenance.test.ts
│  │     └─ discover.test.ts  availability.test.ts
│  ├─ provider/                         # @<scope>/<repo>-provider — FACTS, repo-owned downstream
│  │  ├─ package.json  tsconfig.json
│  │  ├─ src/{pack,curated,invariants,effort,fallback,index}.ts
│  │  ├─ fixtures/{catalog.json,chat-max.json,chat-low.json}
│  │  └─ test/{pack,invariants}.test.ts
│  ├─ cli/                              # @<scope>/<repo>-cli — tools, never imports a host
│  │  ├─ package.json                   # bin: provider-{check,probe,report,
│  │  │                                #      doctor,init,sync,boundaries}
│  │  └─ src/commands/
│  │     ├─ check-catalog.ts  probe-effort.ts  probe-routes.ts
│  │     ├─ report.ts  doctor.ts  init.ts  sync-template.ts  boundaries.ts
│  └─ conformance/                      # @<scope>/<repo>-conformance — dev-only
│     ├─ package.json                   # the only package allowed to import
│     │                                 #   everything, including adapters
│     └─ test/
├─ adapters/                            # harness entrypoints (install surfaces)
│  ├─ pi/                               # pi-provider-<id>, "pi": { extensions }
│  │  ├─ package.json  tsconfig.json
│  │  ├─ src/{index,model}.ts           # createProvider + preload + projection
│  │  └─ test/model.test.ts
│  └─ opencode/                         # opencode-provider-<id>
│     ├─ package.json  tsconfig.json
│     ├─ src/{index,model}.ts           # Plugin.define + transform + projection
│     └─ test/model.test.ts
└─ examples/
   ├─ tier-a/{package.json,src/pack.ts,fixtures/catalog.json}   # self-describing
   ├─ tier-b/{...}                                              # partial
   └─ tier-c/{...}                                              # bare catalog
```

Tests that need *both* hosts plus the corpus live in `packages/conformance`:

```
│     └─ test/
│        ├─ projection.test.ts  invariants.test.ts  pack-schema.test.ts
│        ├─ secrets.test.ts  skills.test.ts  agents.test.ts
│        └─ harness/{mock-fetch,host-stubs}.ts
```

### 7.2 Provider repo, after `provider-init` (e.g. `cosmoshub-integrations`)

```
cosmoshub-integrations/
├─ AGENTS.md  CLAUDE.md → AGENTS.md          ← template
├─ .agents/skills/**  .claude/skills → …     ← template
├─ .gitattributes  .editorconfig  .node-version  .gitignore
├─ .github/workflows/check.yaml              ← template
├─ package.json                              ← hybrid: name + description owned
├─ pnpm-workspace.yaml                       ← template (init drops examples/*)
├─ tsconfig*.json  mise.toml  Taskfile.yaml  renovate.json   ← template
├─ LICENSE  README.md  SECURITY.md           ← owned (rendered once)
├─ CONTRIBUTING.md  TEMPLATE.md              ← template
├─ template.lock.json                        ← owned (version + owned/deleted)
├─ docs/
│  ├─ DESIGN.md  STRUCTURE.md  SYNC.md  ADDING-A-PROVIDER.md  THINKING.md  ← template
│  ├─ EVIDENCE.md                            ← owned: probe log, dates, commands
│  ├─ PROVIDERS.md                            ← generated by provider-report
│  └─ REPO.md                                 ← owned: vendor notes, quirks
├─ packages/
│  ├─ contract/**  catalog/**                ← template
│  ├─ cli/**  conformance/**                 ← template
│  └─ provider/                              ← OWNED, the only place vendor lives
│     ├─ package.json                        ← hybrid: name = provider-cosmoshub
│     ├─ src/
│     │  ├─ pack.ts                          # discovery + fields + filter + hooks
│     │  ├─ curated.ts                       # display names, brand/owner overrides
│     │  ├─ invariants.ts                    # vendor-documented ground truth
│     │  ├─ effort.ts                        # measured wire effort per model
│     │  ├─ fallback.ts                      # pinned offline membership
│     │  └─ index.ts                         # export const packs = [cosmoshub]
│     ├─ fixtures/                           # sanitized live payloads
│     └─ test/{pack,invariants}.test.ts
├─ adapters/
│  ├─ pi/**                                  ← template (pi-provider-cosmoshub)
│  └─ opencode/**                            ← template
└─ examples/                                 ← deleted by init
```

Install surface on a machine (two paths per repo, nothing else):

```
Pi      → /path/cosmoshub-integrations/adapters/pi/src/index.ts
OpenCode→ file:///path/cosmoshub-integrations/adapters/opencode/src/index.ts
```

### 7.3 `AGENTS.md` skeleton (same file in every repo)

```
# <repo> provider integration
1. What this repo is                    (5 lines)
2. Read first                           (DESIGN, SYNC, EVIDENCE, REPO)
3. Package map + layer table + import matrix   (~20 lines — the core section)
4. Commands                             task check | check:catalog | probe:effort
                                        | sync:template | report | doctor
5. Hard invariants                      no invented capability/effort; unmeasured ⇒
                                        no menu; generated files untouched; no keys
                                        in fixtures; lockfile not hand-edited;
                                        contract changes need packSchemaVersion
6. Change protocol                      fixture → invariants → projection test →
                                        code → task check → evidence line
7. Human decisions                      template bump, schema bump, fallback
                                        deletion, ambiguous effort mapping
8. Vendor notes: read `docs/REPO.md`
```

`CLAUDE.md` is a symlink, so all three harnesses read one file. `provider-doctor`
fails on both OSes if the symlink was checked out as a plain file.

### 7.4 What `provider-init` does to the template

| Action | Detail |
|---|---|
| render | `README.md`, `LICENSE`, `SECURITY.md` |
| rename | `packages/provider/package.json` → `provider-<id>`; root `name`/`description` |
| seed | copy `examples/tier-{a,b,c}` choice into `packages/provider/` |
| prune | delete `examples/`, rewrite `pnpm-workspace.yaml` to `packages/* + adapters/*` |
| pin | write `template.lock.json` with the current tag, `owned[]`, `deleted: ["examples/**"]` |
| verify | `task check` must pass before the first commit |

---

## 8. Where the adapters live: alternatives

Verified first, because it settles half the argument: pnpm does not care. A
workspace with `packages/*` and `adapters/*` globs installs, links
`workspace:*` dependencies across the two directories, runs `pnpm -r check`
across both, and resolves `pnpm --filter ./adapters/pi`. Confirmed with a
scratch workspace on this machine. So this is **purely a vocabulary decision**,
not a mechanism one.

The only mechanical rule that follows: scripts must use `pnpm -r` or package
names, never a path glob like `--filter ./packages/*`, or the adapters silently
skip CI. That goes in `AGENTS.md` and is asserted by `provider-boundaries`.

### Candidates

| Layout | Says what it is | Whose vocabulary | 3rd host (Codex, T3, Claude) | Notes |
|---|---|---|---|---|
| `adapters/pi`, `adapters/opencode` | yes: translation into a host API | ours (matches `STRUCTURE.md` layers) | natural | symmetric, short paths |
| `harnesses/pi`, `harnesses/opencode` | yes: the harness side | domain (how you talk about Pi/OpenCode) | natural | runner-up; slightly wider word |
| `extensions/pi`, `extensions/opencode` | partly | **Pi's** word | awkward | OpenCode calls them *plugins*; the dir would mislabel one sibling |
| `integrations/pi-extensions`, `integrations/opencode-plugin` | no | mixed | awkward | repo is already `*-integrations`; plural/singular asymmetry; longest install paths |
| `packages/pi`, `packages/opencode` (status quo) | no | ours | natural | works, but the two install surfaces look like internal libraries, and `packages/` loses its clean rule (see below) |
| root `pi.ts`, `opencode.ts` | yes | n/a | natural | cheapest paths, but see rejection below |

### Why not the two suggestions, specifically

- **`extensions/`** is Pi's noun. OpenCode's nouns are *plugin*, *provider*,
  *agent*. Naming the OpenCode adapter `extensions/opencode` means every future
  reader has to translate. If we wanted harness-native words we would need
  `extensions/pi` **and** `plugins/opencode`, which is asymmetric — and `plugins/`
  is worse than asymmetric: OpenCode auto-discovers `.opencode/plugins/`, so a
  top-level `plugins/` invites a future reader to think it is auto-loaded when it
  is not.
- **`integrations/…`** repeats the repo name (`cosmoshub-integrations/integrations/…`),
  mixes plural and singular (`pi-extensions` vs `opencode-plugin`), and produces
  the longest install path of any option. If the word is `integrations`, then
  `integrations/pi` and `integrations/opencode` would at least be symmetric — but
  at that point it is just `adapters/` with a longer word.

### Why not root files

Two root files (`pi.ts`, `opencode.ts`) is genuinely tempting: a stable install
path, no extra `package.json`, no `tsconfig`. Rejected because it gives up the
thing the layering exists for:

- the forbidden-direction rule stops being expressible. A root file can import
  anything, and anything can import it, so "`provider` may not import a host"
  degrades from a resolution error into a code-review hope;
- host peer dependencies (`@earendil-works/pi-ai`, `@opencode-ai/plugin`) would
  land in the root package, so every repo installs both hosts' SDKs even if only
  one is used;
- Pi's `pi.extensions` manifest field needs a package to live in;
- a third host would add a third root file with no grouping.

### Why not leave them in `packages/`

It works, and it is what `commandcode-integrations` does today. But it costs the
`packages/` rule its sharpness: with `packages/pi` in there, "`packages/` holds
libraries and tools that take no host SDK peer" has two exceptions, and a rule
with exceptions is a rule nobody applies. Moving exactly the two install surfaces
out keeps every directory's rule one sentence long (see the table in §2).

### Decision

`adapters/pi` and `adapters/opencode`. Runner-up: `harnesses/pi`,
`harnesses/opencode` if the domain word reads better to you.

Renaming later is cheap and does not touch the engine: one `git mv`, one glob in
`pnpm-workspace.yaml`, one word in `AGENTS.md`, and the two install paths per
machine (Pi `settings.json`, OpenCode `plugins`). Nothing inside `packages/`
changes, because its packages reference the adapters only through
`@<scope>/<repo>-conformance`.
