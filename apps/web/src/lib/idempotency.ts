import { SupabaseClient } from "@supabase/supabase-js";
import { Flow402Error } from "./flow402-error";

type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyClaimInput = {
    id: string;
    method: string;
    path: string;
    bodySha: string;
    ttlMs?: number;
};

export type IdempotencyReplay = {
    type: "replay";
    status: number;
    body: unknown;
};

export type IdempotencyClaimResult =
    | { type: "claimed" }
    | { type: "locked" }
    | { type: "conflict"; reason: string }
    | IdempotencyReplay;

type IdempotencyRow = {
    id: string;
    method: string;
    path: string;
    body_sha: string;
    response_status: number | null;
    response_body: unknown | null;
    created_at: string;
};

export class IdempotencyStore {
    private readonly ttlMs: number;

    constructor(private readonly supabase: AnySupabaseClient) {
        this.ttlMs = DEFAULT_TTL_MS;
    }

    async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult> {
        const normalizedKey = input.id.trim();
        if (!normalizedKey) {
            throw new Flow402Error(
                "idempotency_conflict",
                "Idempotency key must be provided for write operations",
                { status: 400 }
            );
        }

        const ttlMs = input.ttlMs ?? this.ttlMs;

        const insertResult = await this.supabase
            .from("idempotency_keys")
            .insert({
                id: normalizedKey,
                method: input.method,
                path: input.path,
                body_sha: input.bodySha,
            })
            .select("id")
            .single();

        if (!insertResult.error) {
            return { type: "claimed" };
        }

        if (insertResult.error?.code !== "23505") {
            throw new Flow402Error("idempotency_store_failed", "Unable to claim idempotency key", {
                status: 500,
                cause: insertResult.error,
            });
        }

        const existing = await this.getRecord(normalizedKey);
        if (!existing) {
            // Row disappeared after the unique constraint error; try again once.
            return this.claim({ ...input, id: normalizedKey });
        }

        if (this.isExpired(existing, ttlMs)) {
            await this.supabase.from("idempotency_keys").delete().eq("id", normalizedKey);
            return this.claim({ ...input, id: normalizedKey });
        }

        if (
            existing.method !== input.method ||
            existing.path !== input.path ||
            existing.body_sha !== input.bodySha
        ) {
            return {
                type: "conflict",
                reason: "idempotency_key_reused_with_different_payload",
            };
        }

        if (typeof existing.response_status === "number" && existing.response_body !== null) {
            return {
                type: "replay",
                status: existing.response_status,
                body: existing.response_body,
            };
        }

        return { type: "locked" };
    }

    async persistResponse(id: string, status: number, body: unknown): Promise<void> {
        const { error } = await this.supabase
            .from("idempotency_keys")
            .update({
                response_status: status,
                response_body: body,
            })
            .eq("id", id);

        if (error) {
            throw new Flow402Error("idempotency_store_failed", "Unable to persist idempotency result", {
                status: 500,
                cause: error,
            });
        }
    }

    async release(id: string): Promise<void> {
        await this.supabase.from("idempotency_keys").delete().eq("id", id);
    }

    private async getRecord(id: string): Promise<IdempotencyRow | null> {
        const { data, error } = await this.supabase
            .from("idempotency_keys")
            .select("id, method, path, body_sha, response_status, response_body, created_at")
            .eq("id", id)
            .maybeSingle();

        if (error) {
            throw new Flow402Error("idempotency_store_failed", "Unable to load idempotency key", {
                status: 500,
                cause: error,
            });
        }

        return data ?? null;
    }

    private isExpired(record: IdempotencyRow, ttlMs: number): boolean {
        const createdAt = Date.parse(record.created_at);
        if (!Number.isFinite(createdAt)) {
            return false;
        }
        return Date.now() - createdAt > ttlMs;
    }
}
