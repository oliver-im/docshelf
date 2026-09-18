export function parseGitHubMarkdownUrl(source: string): {
    sourceUrl: string;
    rawUrl: string;
    linkBaseUrl: string;
    owner: string;
    repository: string;
    fileName: string;
} | null;
