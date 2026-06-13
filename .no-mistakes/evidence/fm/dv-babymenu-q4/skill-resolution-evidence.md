# Skill Removal Validation Evidence

Intent validated: remove only the vendored installed `no-mistakes` skill copy from this repository, preserve the repository skill tree and `.claude/skills` symlink, and confirm `no-mistakes` still resolves from the user-level skill.

## Changed Files

Command: `git diff --name-status 4f08ccd12ed616417117573097378a314d81551d...733f395b1477b84f4221ba96ae3253d20e1eec6f`

```text
D	.agents/skills/no-mistakes/SKILL.md
```

## Repository Skill Tree

Command: `git ls-tree -r --name-only 733f395b1477b84f4221ba96ae3253d20e1eec6f .agents .claude | sort`

Result: only `.agents/skills/no-mistakes/SKILL.md` is gone; `.agents/skills/baby-menu-design/**` remains tracked and `.claude/skills` remains tracked.

## Runtime Checks

Command:

```sh
if [ -L ".claude/skills" ]; then printf '.claude/skills symlink -> %s\n' "$(readlink .claude/skills)"; else printf '.claude/skills is not a symlink\n'; fi
if [ -e ".agents/skills/no-mistakes/SKILL.md" ]; then printf 'repo no-mistakes skill: present\n'; else printf 'repo no-mistakes skill: absent\n'; fi
if [ -f "$HOME/.agents/skills/no-mistakes/SKILL.md" ]; then printf 'user no-mistakes skill: present at %s\n' "$HOME/.agents/skills/no-mistakes/SKILL.md"; else printf 'user no-mistakes skill: missing\n'; fi
```

```text
.claude/skills symlink -> ../.agents/skills
repo no-mistakes skill: absent
user no-mistakes skill: present at /Users/kunchen/.agents/skills/no-mistakes/SKILL.md
```

## Skill Resolver Check

Tool: `functions.skill({"name":"no-mistakes"})`

```text
Base directory for this skill: file:///Users/kunchen/.agents/skills/no-mistakes
```
