#!/usr/bin/env bash
# Runs a local copy of the session-topic mod in every session, without
# installing it as a plugin.
#   1. Copies session-topic/, next to this script, to ~/.claude/mods/session-topic/.
#   2. Adds that path to env.CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json.
# Only that key is added to the settings, a backup of the file is kept, and a
# second run leaves the settings alone. Sessions started afterwards load the mod.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/session-topic"
DEST="$HOME/.claude/mods/session-topic"
SETTINGS="$HOME/.claude/settings.json"

if [ ! -f "$SRC/.claude-plugin/plugin.json" ]; then
  echo "The mod is not where it should be: $SRC/.claude-plugin/plugin.json" >&2
  exit 1
fi

python3 - "$SRC" "$DEST" "$SETTINGS" <<'EOF'
import json
import os
import shutil
import sys
import tempfile
import time

src, dest, path = sys.argv[1:4]
KEY = 'CLAUDE_CODE_PLUGIN_DIRS'

# The settings are read and checked before anything is copied or written.
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as err:
        sys.exit(f'{path} is not valid JSON, so nothing was changed. Fix it first. ({err})')

env = data.get('env', {}) if isinstance(data, dict) else None
if not isinstance(env, dict) or not isinstance(env.get(KEY, ''), str):
    sys.exit(
        f'{path} does not have the expected shape, so nothing was changed: '
        f'it has to be an object, "env" an object, and "{KEY}" a string.'
    )

# Files of the mod are written over. What Claude Code wrote into the copy
# (.claude-plugin/types/) is not in the source and stays.
shutil.copytree(src, dest, dirs_exist_ok=True)
print(f'Copied the mod to {dest}')


def same(a, b):
    """True if two spellings name one folder, `~` and a trailing slash aside."""
    return os.path.normpath(os.path.expanduser(a)) == os.path.normpath(os.path.expanduser(b))


dirs = [d for d in env.get(KEY, '').split(os.pathsep) if d]
if any(same(d, dest) for d in dirs):
    print(f'{KEY} already has the path, so {path} was left as it is.')
else:
    if os.path.exists(path):
        backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, backup)
        print(f'Backup: {backup}')

    env[KEY] = os.pathsep.join(dirs + [dest])
    data['env'] = env

    # Written beside the file and then swapped in, so that a failure on the
    # way cannot leave half a file behind.
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=folder, prefix='.settings-', suffix='.json')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
    if os.path.exists(path):
        shutil.copymode(path, temporary)
    os.replace(temporary, path)
    print(f'Added the path to {KEY} in {path}')

print('Done. Sessions started from now on load the mod.')
EOF
