import crypto from "node:crypto";

const SIGNATURE_HEADER_CANDIDATES = ["x-f402-sig", "x-flow402-signature"];
const BODY_HASH_HEADER = "x-f402-body-sha";
const ALLOWED_SKEW_SECONDS = 5 * 60;

interface HeaderGetter {
    get(name: string): string | null;
}

export interface VerifiableRequest {
    headers: HeaderGetter;
    text(): Promise<string>;
}

export interface SignatureComputation {
    header: string;
    digest: string;
    timestamp: number;
}

export interface VerificationSuccess {
    ok: true;
    body: string;
    timestamp: number;
    signature: string;
}

export interface VerificationFailure {
    ok: false;
    body: string;
    reason: string;
}

export type VerificationResult = VerificationSuccess | VerificationFailure;

export function hashBody(body: string): string {
    return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

export function computeSig(secret: string, body: string, timestamp?: number): SignatureComputation {
    if (!secret) {
        throw new Error("Signing secret is required");
    }

    const ts = typeof timestamp === "number" ? timestamp : Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
    return {
        header: `t=${ts},v1=${digest}`,
        digest,
        timestamp: ts,
    };
}

export async function verify(
    req: VerifiableRequest,
    secret: string,
    options: { now?: number } = {}
): Promise<VerificationResult> {
    const body = await req.text();
    const headerValue = getSignatureHeader(req.headers);
    if (!headerValue) {
        return { ok: false, body, reason: "missing_signature_header" };
    }

    const parsed = parseSignatureHeader(headerValue);
    if (!parsed) {
        return { ok: false, body, reason: "invalid_signature_format" };
    }

    const { timestamp, signature } = parsed;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > ALLOWED_SKEW_SECONDS) {
        return { ok: false, body, reason: "timestamp_out_of_window" };
    }

    const bodyHashHeader = normalizeHex(req.headers.get(BODY_HASH_HEADER));
    if (!bodyHashHeader) {
        return { ok: false, body, reason: "missing_body_hash" };
    }

    const computedBodyHash = hashBody(body);
    if (!timingSafeEqualHex(bodyHashHeader, computedBodyHash)) {
        return { ok: false, body, reason: "body_hash_mismatch" };
    }

    const computed = computeSig(secret, body, timestamp);
    if (!timingSafeEqualHex(signature, computed.digest)) {
        return { ok: false, body, reason: "signature_mismatch" };
    }

    return {
        ok: true,
        body,
        signature,
        timestamp,
    };
}

function getSignatureHeader(headers: HeaderGetter): string | null {
    for (const name of SIGNATURE_HEADER_CANDIDATES) {
        const value = headers.get(name);
        if (value) {
            return value;
        }
    }
    return null;
}

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
    const parts = header.split(",").map((part) => part.trim());
    let timestamp: number | null = null;
    let signature: string | null = null;

    for (const part of parts) {
        const [rawKey, rawValue] = part.split("=");
        const key = rawKey?.trim();
        const value = rawValue?.trim();
        if (!key || !value) {
            continue;
        }

        if (key === "t") {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
                timestamp = parsed;
            }
        } else if (key === "v1") {
            signature = normalizeHex(value);
        }
    }

    if (!timestamp || !signature) {
        return null;
    }

    return { timestamp, signature };
}

function normalizeHex(input: string | null): string {
    return typeof input === "string" ? input.trim().toLowerCase() : "";
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) {
        return false;
    }

    try {
        const aBuf = Buffer.from(a, "hex");
        const bBuf = Buffer.from(b, "hex");

        if (aBuf.length !== bBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(aBuf, bBuf);
    } catch {
        return false;
    }
}
