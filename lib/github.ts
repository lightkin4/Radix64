// Reads a GitHub repository as plain text so the local model can rebuild it.
// Public repositories need no credentials; a token unlocks private ones.

export type RepoFile = { path: string; content: string };

export type RepoSnapshot = {
  owner: string;
  repo: string;
  branch: string;
  url: string;
  description: string | null;
  language: string | null;
  files: { path: string; size: number }[];
  contents: RepoFile[];
  importedAt: string;
  truncated: boolean;
};

const MAX_LISTED = 300;
const MAX_CONTENT_FILES = 32;
const MAX_FILE_CHARS = 6000;
const MAX_TOTAL_CHARS = 160_000;
const MAX_FILE_BYTES = 120_000;

const ignored = [
  /^\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|\.next|out|vendor|coverage|\.cache)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.lock|Gemfile\.lock)$/,
  /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tgz|rar|7z|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|wasm|exe|dll|so|dylib|class|jar)$/i,
];

// Files that explain the app come first when the budget is tight.
function score(path: string): number {
  const value = path.toLowerCase();
  if (/(^|\/)(readme)(\.|$)/.test(value)) return 0;
  if (/(^|\/)package\.json$/.test(value)) return 1;
  if (/(^|\/)(index|main|app)\.(html?|tsx?|jsx?|py|go|rb|php)$/.test(value)) return 2;
  if (/(^|\/)(app|src|pages|components|lib)\//.test(value)) return 3;
  if (/\.(tsx?|jsx?|css|scss|html?|vue|svelte|py|go|rb|php|json|md)$/.test(value)) return 4;
  return 5;
}

export function parseRepo(input: string): { owner: string; repo: string; branch?: string } {
  const cleaned = input
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "");
  const [owner, rest, ...tail] = cleaned.split("/");
  const repo = (rest ?? "").split(/[?#]/)[0];
  if (!owner || !repo) {
    throw new Error("Use a GitHub repository like owner/repo or a github.com URL.");
  }
  const branch = tail[0] === "tree" && tail[1] ? tail[1] : undefined;
  return { owner, repo, branch };
}

async function github<T>(url: string, token: string | null, accept: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "radix64",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });
  if (response.status === 404) {
    throw new Error("Repository, branch or file not found — check the name, or add a token for private repos.");
  }
  if (response.status === 403) {
    throw new Error("GitHub rate-limited this request. Add a personal access token and try again.");
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return response.json();
}

async function fileText(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token: string | null,
): Promise<string | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = token
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
    : `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
  const response = await fetch(url, {
    headers: {
      Accept: token ? "application/vnd.github.raw" : "text/plain",
      "User-Agent": "radix64",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.slice(0, 1000).includes("\u0000")) return null;
  return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n[truncated]` : text;
}

type Tree = { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };

export async function readRepo(
  input: string,
  options: { branch?: string; token?: string | null } = {},
): Promise<RepoSnapshot> {
  const { owner, repo, branch: fromUrl } = parseRepo(input);
  const token = options.token?.trim() || null;
  const meta = await github<{ default_branch?: string; description?: string | null; language?: string | null; full_name?: string }>(
    `https://api.github.com/repos/${owner}/${repo}`,
    token,
    "application/vnd.github+json",
  );
  const branch = options.branch?.trim() || fromUrl || meta.default_branch || "main";
  const tree = await github<Tree>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
    "application/vnd.github+json",
  );

  const blobs = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && (entry.size ?? 0) <= MAX_FILE_BYTES)
    .filter((entry) => !ignored.some((pattern) => pattern.test(entry.path)))
    .sort((a, b) => score(a.path) - score(b.path) || a.path.localeCompare(b.path));

  if (blobs.length === 0) {
    throw new Error("This repository has no readable source files.");
  }

  const contents: RepoFile[] = [];
  let total = 0;
  for (const blob of blobs.slice(0, MAX_CONTENT_FILES * 3)) {
    if (contents.length >= MAX_CONTENT_FILES) break;
    if (total >= MAX_TOTAL_CHARS) break;
    const text = await fileText(owner, repo, branch, blob.path, token);
    if (!text) continue;
    total += text.length;
    contents.push({ path: blob.path, content: text });
  }

  if (contents.length === 0) {
    throw new Error("This repository has no readable source files.");
  }

  return {
    owner,
    repo: meta.full_name?.split("/")[1] || repo,
    branch,
    url: `https://github.com/${owner}/${repo}`,
    description: meta.description ?? null,
    language: meta.language ?? null,
    files: blobs.slice(0, MAX_LISTED).map((blob) => ({
      path: blob.path,
      size: blob.size ?? 0,
    })),
    contents,
    importedAt: new Date().toISOString(),
    truncated: blobs.length > contents.length || Boolean(tree.truncated),
  };
}
