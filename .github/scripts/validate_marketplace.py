#!/usr/bin/env python3
"""Check .claude-plugin/marketplace.json against the skills/ folders it lists.

Claude installs each skill in this repo as a plugin, sourced straight at
`./skills/<name>`, which works because every skill folder has SKILL.md at its
root. The manifest is hand-maintained, so it drifts the moment someone adds a
skill and forgets the entry: the skill ships in the zip and to the sx vault,
and is simply missing from Claude.

This checks four things:
  - every skills/<name>/SKILL.md has a manifest entry
  - every manifest entry points at a folder that exists and has a SKILL.md
  - the entry name matches the skill's frontmatter name (that name is the
    plugin id users type: <name>@sumble)
  - the entry description matches the frontmatter description

Entries deliberately carry NO `version` field. With a version pinned, Claude
treats the installed copy as current and an edited skill never reaches anyone
who already installed it; with the field absent, the version is the source
commit and Sync delivers every change.

Run locally from the repo root:
    python3 .github/scripts/validate_marketplace.py
"""

from __future__ import annotations

import json
import pathlib
import sys

try:
    import yaml  # PyYAML: correct scalar semantics for quoted / plain / block forms.
except ModuleNotFoundError:  # pragma: no cover - CI installs it; guard for bare envs.
    sys.stderr.write(
        "PyYAML is required: pip install pyyaml (CI does this automatically).\n"
    )
    raise SystemExit(2)

MANIFEST = pathlib.Path(".claude-plugin/marketplace.json")
SKILLS_DIR = pathlib.Path("skills")


def frontmatter(skill_md: pathlib.Path) -> dict:
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise ValueError("missing YAML frontmatter (no leading '---')")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("unterminated YAML frontmatter (no closing '---')")
    data = yaml.safe_load(parts[1])
    if not isinstance(data, dict):
        raise ValueError("frontmatter is not a mapping")
    return data


def main() -> int:
    if not MANIFEST.is_file():
        sys.stderr.write(f"{MANIFEST} not found (run from the repo root)\n")
        return 1

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = {e.get("name"): e for e in manifest.get("plugins", [])}
    on_disk = sorted(d.name for d in SKILLS_DIR.iterdir() if (d / "SKILL.md").is_file())

    problems: list[str] = []

    for name in on_disk:
        if name not in entries:
            problems.append(
                f"skills/{name} has no entry in {MANIFEST} "
                f"— it will not appear in Claude"
            )

    for name, entry in entries.items():
        source = entry.get("source", "")
        expected = f"./skills/{name}"
        if source != expected:
            problems.append(f"{name}: source is {source!r}, expected {expected!r}")
        if "version" in entry:
            problems.append(
                f"{name}: remove the 'version' field — a pinned version stops "
                f"updates reaching anyone who already installed the plugin"
            )

        skill_md = SKILLS_DIR / name / "SKILL.md"
        if not skill_md.is_file():
            problems.append(f"{name}: {skill_md} does not exist")
            continue

        try:
            fm = frontmatter(skill_md)
        except (ValueError, yaml.YAMLError) as exc:
            problems.append(f"{name}: cannot parse {skill_md}: {exc}")
            continue

        if fm.get("name") != name:
            problems.append(
                f"{name}: frontmatter name is {fm.get('name')!r}; the manifest "
                f"entry name must match, it is the id users type"
            )
        if fm.get("description") != entry.get("description"):
            problems.append(
                f"{name}: description differs from {skill_md} frontmatter "
                f"— copy the frontmatter description into the manifest"
            )

    if problems:
        for msg in problems:
            print(f"::error file={MANIFEST}::{msg}")
            print(f"FAIL {msg}", file=sys.stderr)
        sys.stderr.write(f"\n{MANIFEST} is out of sync with skills/.\n")
        return 1

    print(f"ok   {MANIFEST} lists all {len(on_disk)} skill(s), sources and text match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
