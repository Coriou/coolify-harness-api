/**
 * Minimal, dependency-free helpers for the docker-compose documents Coolify stores (service
 * `docker_compose_raw`, the server proxy `configuration`). They only touch `image:` lines, so a
 * round-trip never re-serialises the YAML: comments, quoting, anchors and ordering are preserved
 * byte for byte, and Coolify sees exactly the document it had plus the one edited line.
 */
export interface ServiceImage {
    service: string;
    image: string;
    /** 0-based line index of the `image:` line. */
    line: number;
}
/** True for a plausible OCI image reference (`repo[:tag][@sha256:digest]`, lowercase repo). */
export declare function isValidImageRef(ref: string): boolean;
/** List the `image:` of every service under the top-level `services:` key. */
export declare function listServiceImages(yaml: string): ServiceImage[];
/**
 * Return `yaml` with the `image:` of `service` replaced by `image`, preserving the line's
 * indentation and quote style. Throws when the service or its image line does not exist.
 */
export declare function setServiceImage(yaml: string, service: string, image: string): string;
/** Split `repo[:tag]` → { repo, tag } (digest-aware; a registry port is not mistaken for a tag). */
export declare function splitImageRef(ref: string): {
    repo: string;
    tag: string | undefined;
};
export declare function sha256(text: string): string;
export declare function toBase64(text: string): string;
export type DiffOp = {
    op: 'same' | 'del' | 'add';
    line: string;
};
/** LCS line diff. Compose files are small (tens to hundreds of lines), so O(n·m) is fine. */
export declare function diffLines(before: string, after: string): DiffOp[];
/**
 * Human diff of two compose documents with secrets redacted on both sides. A changed line whose
 * redacted form is identical (i.e. only a secret value changed) is reported as such instead of
 * showing two identical `-`/`+` lines.
 */
export declare function formatRedactedDiff(before: string, after: string): string[];
