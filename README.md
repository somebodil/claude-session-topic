# session-topic

A [Claude Code](https://claude.com/claude-code) mod that keeps one line above the prompt saying what the conversation is about right now.

```
주제 · Git 충돌 해결
```

The label is a short noun phrase in the language you write in. It changes when the conversation moves on to something else, and stays as it is while it still fits.

The word in front of it is an option. Its default, `주제`, is Korean for "topic".

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install session-topic --marketplace somebodil/claude-session-topic
```

Answer `y` to add the marketplace, then choose a scope. The mod is active from then on, with no restart.

From a shell, the same line is below. Here it also sets the word in front of the label:

```bash
claude plugin install session-topic --marketplace somebodil/claude-session-topic --config prefix=Topic
```

In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `somebodil/claude-session-topic`, then **Add plugin**.

To remove it, run `claude plugin uninstall session-topic`. Add `--scope project` or `--scope local` if that is where you installed it.

## Requirements

- A Claude Code that supports mods, which are plugins with a hooks module. The mod was made and tested on Claude Code 2.1.329. The API that mods use is early access and can change between releases.
- An account that can call Haiku.

## Options

| Option | Default | What it is |
| --- | --- | --- |
| `prefix` | `주제` | The word in front of the label, 20 characters at most |

Set it when you install, as above, or later in `/config`.

## When the label is refreshed

- **When you submit a prompt.** Only your own words count: typed at the prompt, or sent through Remote Control or from Slack. A slash command, a notice from a background task, a scheduled prompt, and a message from another session do not refresh the label. Neither does a prompt that another hook blocked: it is sent nowhere.
- **When an answer of the main conversation is complete.** A subagent's answer does not count, and neither does a turn that was interrupted, refused, or ended in an error.
- **When Claude Code starts with a conversation in it**, as with `claude --continue`.

After a `/clear` or a `/resume` the label is taken down until the next prompt or answer.

For each refresh, the 8 most recent messages are sent to Haiku together with the label that is shown. The prompt you just submitted is one of the 8. Each message is cut to 500 characters, and system reminders are left out. Haiku is asked to repeat the label when it still fits, so the words change only when the topic does. When a request fails, the label that is shown stays.

## Cost and privacy

- **Requests.** There are up to two Haiku requests for each answer: one when you submit the prompt, one when the answer is complete. A request holds about 4,200 characters of the conversation at most, plus the instructions, and the reply is limited to 80 tokens.
- **Account.** The requests are made with the account of the session, so they count toward the same usage limits. They do not touch the context of the conversation or its prompt cache.
- **Where the text goes.** To the provider your session already talks to, and nowhere else. The mod reads no files, writes none, and runs no commands.
- **Sessions without a screen.** A session that draws nowhere, such as `claude -p` or an SDK run, has no band to fill, so the mod makes no requests there.
- **The label is a hint.** A model writes it from the conversation, which can include text from files and web pages. It is limited to one line of 40 characters and shown as plain text, with control characters removed.

`DISABLE_NON_ESSENTIAL_MODEL_CALLS=1` does not stop these requests (checked on 2.1.329). Disable or uninstall the mod to stop them.

## Known limits

- The band is drawn in the terminal, the desktop app, and the mobile app. Claude Code does not raise it in VS Code.
- If the mod is loaded twice, for example from a folder you are developing in and from an installed copy, each copy makes its own requests.

## Changing the code

An installed mod runs a copy of this repository, so changing it means working in a clone: see Development below. The values you are most likely to change are at the top of `session-topic/hooks/register.tsx`.

| Value | Now | What it is |
| --- | --- | --- |
| `RECENT_MESSAGES` | 8 | How many recent messages are sent to Haiku |
| `CLIP_CHARS` | 500 | Where a message is cut |
| `MAX_LABEL_CHARS` | 40 | Where a label is cut. The instructions ask for 30 characters at most |
| `RECENT_ROWS` | 200 | How many rows of the transcript are read to find those messages |
| `SYSTEM` | the instructions | The language, the length, and when to keep the label |
| `model: 'haiku'` | Haiku | The model that writes the label |
| `DEFAULT_PREFIX` | `주제` | The word in front of the label when the option is not set |

To halve the requests, remove the refresh from the `prompt.submit` hook. The label then changes only when an answer is complete, and the tests that submit a prompt have to change with it.

## Development

```bash
claude --plugin-dir ./session-topic       # run the mod from this folder, for one session
claude plugin validate ./session-topic    # the manifest, the hooks, and what the module calls
claude plugin test ./session-topic        # the tests
```

- An interactive session watches the folder and loads the module again when a file is saved.
- When Claude Code loads the mod, it writes its type definitions to `session-topic/.claude-plugin/types/`. Git ignores that folder. With the types there, `tsc -p session-topic` checks the types of the module and the tests.

### A local copy for every session

`install.sh` runs a local copy of the mod in every session without installing it as a plugin. It is how the author uses the mod while working on it.

```bash
bash install.sh
```

- It copies `session-topic/` to `~/.claude/mods/session-topic/`.
- It adds that path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. That is the only key it adds, but the file is written anew as JSON with two-space indentation. A backup, `settings.json.bak-<time>`, is kept beside it.
- If the file is not valid JSON, nothing is copied or changed.
- A second run copies the files again and leaves the settings alone.

To undo it, take the path out of `CLAUDE_CODE_PLUGIN_DIRS` and delete `~/.claude/mods/session-topic/`.

Use either this or an installed copy, not both: each would make its own requests.

## License

[MIT](LICENSE)
