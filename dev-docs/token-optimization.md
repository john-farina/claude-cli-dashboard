# Token Optimization Guide

## Why Token Efficiency Matters

Every agent turn re-sends the full conversation history plus system context. On a Max plan with 5 concurrent agents, token waste compounds fast:

- **CLAUDE.md loads every turn** -- a 20KB file costs ~5,000 tokens/turn. Over a 20-turn session that's 100K tokens just for instructions. This is why CLAUDE.md was slimmed and reference sections moved to `dev-docs/`.
- **Conversation history accumulates** -- a 30-turn agent can cost 50-150K input tokens per new message. A fresh agent for the same task costs ~5K. Prefer spawning new agents over reusing long-lived ones for unrelated tasks.
- **Unnecessary full turns are expensive** -- sending a message to an agent just to say "you were renamed" replays the entire context. This is why rename notifications are now deferred and prepended to the next real user message.

## Token Budget Breakdown

| Source | Cost per turn | Notes |
|--------|--------------|-------|
| CLAUDE.md (project instructions) | ~2,500 tokens | Loaded automatically by Claude CLI |
| CEO preamble (in conversation history) | ~350 tokens | Injected once, stays in history |
| Conversation history | 5K-200K tokens | Grows with every turn -- dominant cost |
| Tool results (file reads, grep, etc.) | 500-5,000 tokens each | Stays in history after use |
| Agent output (responses) | 200-2,000 tokens each | Also stays in history |

## Design Principles

### 1. Keep CLAUDE.md lean
Only include what agents need on every turn. Move reference material (API tables, howto guides, subsystem docs) to `dev-docs/` and add a one-liner pointer. Agents can read those files on demand when they need them.

### 2. Don't waste full conversation turns
A "conversation turn" replays the entire accumulated context as input tokens. Never send a message to an agent just to inform it of something non-urgent. Instead, piggyback the information onto the next real user message (see rename prefix pattern in `server.js`).

### 3. Auto-rename is cheap but not free
Auto-rename uses Haiku with `--effort low` (~500-1,500 tokens per call). Rate-limit with cooldowns and skip checks when the conversation hasn't advanced. The rename context sent to Haiku is truncated to first 3 messages / 800 bytes.

### 4. Prefer fresh agents for new tasks
Context accumulation is the #1 cost driver. When an agent finishes a task, spawn a new one for the next task instead of reusing the old one. A fresh agent costs ~5K tokens; a 30-turn resumed agent costs 50K+ tokens for the same work.

## What's Already Optimized

- **CLAUDE.md** -- Slimmed from 19.8KB to ~10KB by extracting reference sections to `dev-docs/`
- **Rename notifications** -- Deferred to next user message instead of triggering a standalone turn
- **Rename cooldown** -- 5-minute minimum between checks per agent, skips if conversation hasn't advanced
- **Rename context** -- Truncated to first 3 messages, 800 bytes max (was 8 messages, 2KB)
- **Haiku for rename** -- Uses cheapest model with lowest effort setting
- **Token tracking** -- Reads local JSONL files, zero API cost
- **CEO preamble** -- Lean at 1.4KB, only essential agent instructions
- **Byte-offset caching** -- JSONL parsing resumes from last read position, not full re-parse

## When Adding New Features

Before adding content to CLAUDE.md, ask:
1. Does every agent need this on every turn? If no, put it in `dev-docs/` and add a pointer.
2. Can this be discovered on demand? If yes, it doesn't need to be in CLAUDE.md.
3. Is this triggering an extra conversation turn? If yes, find a way to piggyback it.
