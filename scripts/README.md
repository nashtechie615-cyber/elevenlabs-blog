# Scheduled post generator

Runs nightly at 12:00 AM Central via Windows Task Scheduler. Picks 3 queued topics from `topic-pool.json`, generates fresh MDX posts via the Anthropic API, and writes them to `src/content/blog/`.

## Files

- `topic-pool.json` — the editorial queue. ~45 topics seeded; each includes title, angle, hero image, and video clip.
- `generate-posts.mjs` — the generator. Picks N queued topics, calls Claude, writes MDX, marks topics as published.
- `run-generator.bat` — the wrapper Task Scheduler invokes. Loads `.env`, runs the generator, appends to `generator.log`.
- `register-task.ps1` — one-time PowerShell setup to register the Windows scheduled task.
- `.env.example` — copy to `.env` and fill in.

## First-time setup

1. **Get an Anthropic API key** at https://console.anthropic.com/settings/keys
2. **Create `.env`** in this folder:
   ```
   cp scripts/.env.example scripts/.env
   ```
   Edit and paste your key. Set `AUTO_COMMIT=1` later if you want automatic git pushes.
3. **Test once manually** (dry run, no files written):
   ```
   node scripts/generate-posts.mjs --dry-run --count 1
   ```
   Then a real single post:
   ```
   node scripts/generate-posts.mjs --count 1
   ```
4. **Register the scheduled task** (open PowerShell in this folder):
   ```
   powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1
   ```
5. **Force a test run of the task itself**:
   ```
   Start-ScheduledTask -TaskName 'ElevenLabsDailyPosts'
   Get-Content scripts/generator.log -Tail 50
   ```

## Editing the pool

- The generator picks topics in JSON order; reorder entries to prioritize.
- To add more topics: append objects with `slug`, `title`, `angle`, `category`, `hero`, `video`, `status: "queued"`.
- To skip/retire a topic: set `status: "skipped"` — the generator ignores anything that isn't `"queued"`.
- Hero images must exist in `src/assets/`. Videos must exist in `public/resources/`.

## Disabling / troubleshooting

```powershell
# See the task
Get-ScheduledTask -TaskName 'ElevenLabsDailyPosts' | Get-ScheduledTaskInfo

# Remove it
Unregister-ScheduledTask -TaskName 'ElevenLabsDailyPosts' -Confirm:$false

# Tail the log
Get-Content scripts/generator.log -Wait
```
