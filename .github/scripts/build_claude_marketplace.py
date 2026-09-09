#!/usr/bin/env python3
"""Vendor skills/ from this repo into a Claude plugin marketplace repo.

One plugin per skill, so org admins can set a different installation
preference (or group override) for each one.

Layout produced in the target repo:

    .claude-plugin/marketplace.json
    plugins/<skill>/.claude-plugin/plugin.json
    plugins/<skill>/skills/<skill>/SKILL.md  (+ references/, assets/, scripts/)

The patch version of a plugin is bumped only when that skill's files actually
changed, because organization auto-sync fires on a merged PR that includes a
plugin version bump.

Usage:
    python3 build_claude_marketplace.py --skills-dir skills --target ../marketplace
"""

import argparse
import filecmp
import json
import pathlib
import shutil
import sys

import yaml

# Directories inside a skill folder that must not be vendored. "articles" is
# docs/marketing, not part of the installable skill (mirrors the exclusion in
# build-skill-zips.yml). ".claude-plugin" is the skill folder's own plugin.json
# for the public marketplace; here the skill lands under plugins/<name>/skills/
# and the plugin manifest is written at plugins/<name>/.claude-plugin/ instead,
# so a nested copy would be a second, misplaced manifest.
EXCLUDE_DIRS = {"articles", ".claude-plugin"}
EXCLUDE_FILES = {".DS_Store"}

# Deliberately NOT "sumble", which is the name the public marketplace in this
# repo (.claude-plugin/marketplace.json) declares. Adding a second marketplace
# under a name already in use silently REPLACES the first one: no warning, and
# `plugin marketplace list` then shows one entry. A teammate who has this
# internal marketplace and later follows the public install instructions would
# lose it.
MARKETPLACE_NAME = "sumble-internal"
MARKETPLACE_DESCRIPTION = "Sumble's GTM skills, vendored from sumble-skills-public for the Sumble organization."
OWNER = {"name": "Sumble", "url": "https://sumble.com"}


def read_frontmatter(skill_md: pathlib.Path) -> dict:
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise SystemExit(f"{skill_md}: missing YAML frontmatter")
    _, fm, _ = text.split("---", 2)
    data = yaml.safe_load(fm) or {}
    for key in ("name", "description"):
        if not data.get(key):
            raise SystemExit(f"{skill_md}: frontmatter is missing '{key}'")
    return data


def copy_skill(src: pathlib.Path, dest: pathlib.Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(
        src,
        dest,
        ignore=lambda _dir, names: [
            n for n in names if n in EXCLUDE_DIRS or n in EXCLUDE_FILES
        ],
    )


def trees_differ(a: pathlib.Path, b: pathlib.Path) -> bool:
    if not a.exists() or not b.exists():
        return True
    cmp = filecmp.dircmp(a, b)

    def walk(node) -> bool:
        if node.left_only or node.right_only or node.diff_files or node.funny_files:
            return True
        return any(walk(sub) for sub in node.subdirs.values())

    return walk(cmp)


def bump_patch(version: str) -> str:
    parts = (version or "0.0.0").split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[2] = str(int(parts[2]) + 1)
    except ValueError:
        parts[2] = "1"
    return ".".join(parts[:3])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills-dir", default="skills")
    ap.add_argument("--target", required=True, help="checkout of the marketplace repo")
    args = ap.parse_args()

    skills_dir = pathlib.Path(args.skills_dir).resolve()
    target = pathlib.Path(args.target).resolve()
    plugins_root = target / "plugins"
    plugins_root.mkdir(parents=True, exist_ok=True)

    entries = []
    skill_dirs = sorted(d for d in skills_dir.iterdir() if (d / "SKILL.md").is_file())
    if not skill_dirs:
        raise SystemExit(f"no skills found under {skills_dir}")

    for skill_dir in skill_dirs:
        meta = read_frontmatter(skill_dir / "SKILL.md")
        name = meta["name"]
        plugin_dir = plugins_root / name
        skill_dest = plugin_dir / "skills" / name
        manifest_path = plugin_dir / ".claude-plugin" / "plugin.json"

        old_manifest = {}
        if manifest_path.is_file():
            old_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        staged = plugin_dir / ".staged"
        copy_skill(skill_dir, staged)
        changed = trees_differ(skill_dest, staged)
        if skill_dest.exists():
            shutil.rmtree(skill_dest)
        skill_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staged), str(skill_dest))

        version = old_manifest.get("version", "0.1.0")
        if changed and old_manifest:
            version = bump_patch(version)

        manifest = {
            "$schema": "https://www.schemastore.org/claude-code-plugin-manifest.json",
            "name": name,
            "version": version,
            "description": meta["description"],
            "author": OWNER,
            "license": "MIT",
        }
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

        entries.append(
            {
                "name": name,
                "source": f"./plugins/{name}",
                "description": meta["description"],
            }
        )
        print(f"{name}: version {version}{' (bumped)' if changed and old_manifest else ''}")

    # Drop plugins whose skill was deleted upstream.
    live = {e["name"] for e in entries}
    for stale in plugins_root.iterdir():
        if stale.is_dir() and stale.name not in live:
            shutil.rmtree(stale)
            print(f"removed stale plugin {stale.name}")

    marketplace = {
        "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
        "name": MARKETPLACE_NAME,
        "description": MARKETPLACE_DESCRIPTION,
        "owner": OWNER,
        "plugins": entries,
    }
    mp_path = target / ".claude-plugin" / "marketplace.json"
    mp_path.parent.mkdir(parents=True, exist_ok=True)
    mp_path.write_text(json.dumps(marketplace, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {mp_path} with {len(entries)} plugin(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
