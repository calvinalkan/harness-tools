import { execSync } from "node:child_process";

type GitInfo = {
	branch: string | undefined;
	commit: string | undefined;
	commitShort: string | undefined;
	worktree: string | undefined;
	commonDir: string | undefined;
	remoteUrl: string | undefined;
	repoName: string | undefined;
	userName: string | undefined;
	userEmail: string | undefined;
};

type GitInfoCacheEntry = {
	info: GitInfo;
	fetchedAt: number;
};

const GIT_CACHE_TTL_MS = 15_000;
const gitCache = new Map<string, GitInfoCacheEntry>();

function gitCmd(cmd: string, cwd: string): string | undefined {
	try {
		return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {
		return undefined;
	}
}

function getGitInfo(cwd: string): GitInfo {
	const branch = gitCmd("git branch --show-current", cwd);
	const commit = gitCmd("git rev-parse HEAD", cwd);
	const commitShort = gitCmd("git rev-parse --short HEAD", cwd);
	const worktree = gitCmd("git rev-parse --show-toplevel", cwd);
	const commonDir = gitCmd("git rev-parse --git-common-dir", cwd);
	const remoteUrl = gitCmd("git remote get-url origin", cwd);
	const userName = gitCmd("git config user.name", cwd);
	const userEmail = gitCmd("git config user.email", cwd);

	let repoName: string | undefined;
	if (remoteUrl !== undefined && remoteUrl !== "") {
		const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
		repoName = match?.[1];
	}

	return {
		branch,
		commit,
		commitShort,
		worktree,
		commonDir,
		remoteUrl,
		repoName,
		userName,
		userEmail,
	};
}

function getGitInfoCached(cwd: string): { info: GitInfo; cacheHit: boolean } {
	const now = Date.now();
	const cached = gitCache.get(cwd);
	if (cached !== undefined && now - cached.fetchedAt <= GIT_CACHE_TTL_MS) {
		return { info: cached.info, cacheHit: true };
	}
	const info = getGitInfo(cwd);
	gitCache.set(cwd, { info, fetchedAt: now });
	return { info, cacheHit: false };
}

export { getGitInfo, getGitInfoCached, GitInfo };
