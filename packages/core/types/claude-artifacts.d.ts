export function parseClaudeArtifactUrl(source: string): {
    artifactId: string;
    publicUrl: string;
    embedUrl: string;
} | null;
