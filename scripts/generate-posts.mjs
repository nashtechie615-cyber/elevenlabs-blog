#!/usr/bin/env node
/**
 * generate-posts.mjs
 *
 * Runs daily via Windows Task Scheduler. Picks 3 queued topics from
 * scripts/topic-pool.json, generates MDX blog posts with original copy
 * via the Anthropic API, marks the topics as published, and (optionally)
 * commits + pushes to GitHub.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  (required)
 *   AUTO_COMMIT=1      (optional; runs git add/commit/push after writing)
 *
 * Usage:
 *   node scripts/generate-posts.mjs
 *   node scripts/generate-posts.mjs --dry-run      (prints what would be written)
 *   node scripts/generate-posts.mjs --count 1      (override number of posts)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const POOL_PATH = resolve(__dirname, 'topic-pool.json');
const POSTS_DIR = resolve(ROOT, 'src/content/blog');
const ENV_PATH = resolve(__dirname, '.env');

if (existsSync(ENV_PATH)) {
	for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (!(key in process.env)) process.env[key] = val;
	}
}

const AFFILIATE_URL = 'https://try.elevenlabs.io/8jq9xhb1mno4';
const MODEL = 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COUNT = (() => {
	const i = args.indexOf('--count');
	if (i === -1) return 3;
	return parseInt(args[i + 1], 10) || 3;
})();

function log(...m) {
	const ts = new Date().toISOString();
	console.log(`[${ts}]`, ...m);
}

function todayStamp() {
	const d = new Date();
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')} ${d.getFullYear()}`;
}

async function callClaude(topic) {
	if (!API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

	const prompt = `You are writing a blog post for an independent publication that covers ElevenLabs (the AI voice, music, and audio platform). The publication's voice is confident, plain-spoken, and practical. Short paragraphs. No marketing fluff.

Write an original blog post (minimum 400 words) on this topic:

Title: ${topic.title}
Angle: ${topic.angle}
Category: ${topic.category}

Requirements:
- Minimum 400 words, target around 500.
- 2 to 4 H2 subheadings. Each H2 must be a markdown link to ${AFFILIATE_URL} — formatted as: ## [Subheading text](${AFFILIATE_URL})
- Include at least 2 additional inline markdown links in the body, all pointing to ${AFFILIATE_URL}.
- Do NOT invent statistics, dates, or quotes. Stick to generally-known product capabilities.
- Do NOT copy phrasing from any ElevenLabs marketing or blog page — write original prose.
- Do NOT include frontmatter, a top-level H1, any "import" lines, or any <Video> components. Just the body prose in markdown. The harness adds frontmatter and the video embed.
- Do NOT use curly braces { or } anywhere in the output, not even inside code blocks or backticks — the MDX parser treats them as JSX. Use angle brackets like <voice_id> or plain text like VOICE_ID instead.
- Do NOT use raw HTML tags (e.g., <div>, <br>) in the output.
- Open with a strong hook paragraph. Close with a short call-to-action pointing to ${AFFILIATE_URL}.

Output only the markdown body. No preamble, no explanations.`;

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: MODEL,
			max_tokens: 2000,
			messages: [{ role: 'user', content: prompt }],
		}),
	});

	if (!res.ok) {
		throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
	}
	const data = await res.json();
	const text = data.content?.[0]?.text;
	if (!text) throw new Error('No text in API response');
	return sanitizeForMDX(text.trim());
}

function sanitizeForMDX(body) {
	return body
		.replace(/\{/g, '\\{')
		.replace(/\}/g, '\\}');
}

function truncateAtWord(text, maxLen) {
	if (text.length <= maxLen) return text;
	const slice = text.slice(0, maxLen);
	const lastSpace = slice.lastIndexOf(' ');
	return (lastSpace > 40 ? slice.slice(0, lastSpace) : slice).replace(/[,;:.\-—]\s*$/, '') + '…';
}

function buildMDX(topic, body) {
	const frontmatter = [
		'---',
		`title: ${JSON.stringify(topic.title)}`,
		`description: ${JSON.stringify(truncateAtWord(topic.angle, 200))}`,
		`pubDate: ${JSON.stringify(todayStamp())}`,
		`heroImage: ${JSON.stringify(`../../assets/${topic.hero}`)}`,
		'---',
		'',
		"import Video from '../../components/Video.astro';",
		'',
	].join('\n');

	const firstH2 = body.indexOf('\n## ');
	let bodyWithVideo;
	if (firstH2 === -1) {
		bodyWithVideo = body + `\n\n<Video src="/resources/${topic.video}" caption="See ElevenLabs in action." ratio="16/9" />\n`;
	} else {
		bodyWithVideo =
			body.slice(0, firstH2) +
			`\n\n<Video src="/resources/${topic.video}" caption="See ElevenLabs in action." ratio="16/9" />\n` +
			body.slice(firstH2);
	}

	return frontmatter + '\n' + bodyWithVideo + '\n';
}

async function main() {
	log(`Generating ${COUNT} post${COUNT === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}`);

	const pool = JSON.parse(readFileSync(POOL_PATH, 'utf8'));
	const queued = pool.topics.filter((t) => t.status === 'queued');
	log(`Pool: ${queued.length} queued / ${pool.topics.length} total`);

	if (queued.length < COUNT) {
		log(`WARNING: only ${queued.length} topics queued. Refresh topic-pool.json soon.`);
	}

	const picks = queued.slice(0, COUNT);
	if (picks.length === 0) {
		log('No topics available. Exiting.');
		process.exit(0);
	}

	const written = [];
	for (const topic of picks) {
		log(`→ ${topic.slug}: ${topic.title}`);
		try {
			const body = await callClaude(topic);
			const mdx = buildMDX(topic, body);
			const filePath = resolve(POSTS_DIR, `${topic.slug}.mdx`);
			if (DRY_RUN) {
				log(`   [dry run] would write ${filePath} (${mdx.length} chars)`);
			} else {
				writeFileSync(filePath, mdx, 'utf8');
				log(`   wrote ${filePath}`);
				topic.status = 'published';
				topic.publishedAt = new Date().toISOString();
			}
			written.push(topic.slug);
		} catch (err) {
			log(`   FAILED: ${err.message}`);
		}
	}

	if (!DRY_RUN && written.length > 0) {
		writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2) + '\n', 'utf8');
		log(`Updated ${POOL_PATH}`);
	}

	if (!DRY_RUN && process.env.AUTO_COMMIT === '1' && written.length > 0) {
		log('Committing to git...');
		try {
			execSync('git add src/content/blog scripts/topic-pool.json', { cwd: ROOT, stdio: 'inherit' });
			execSync(`git commit -m "posts: ${written.join(', ')}"`, { cwd: ROOT, stdio: 'inherit' });
			execSync('git push', { cwd: ROOT, stdio: 'inherit' });
			log('Pushed.');
		} catch (err) {
			log(`git step failed: ${err.message}`);
		}
	}

	log(`Done. ${written.length}/${picks.length} posts written.`);
}

main().catch((err) => {
	log('FATAL:', err.stack || err.message);
	process.exit(1);
});
