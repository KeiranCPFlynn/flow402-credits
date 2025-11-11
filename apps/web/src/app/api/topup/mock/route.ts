import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { hashBody } from "@/lib/hmac";
import { IdempotencyStore } from "@/lib/idempotency";

// Validate input
const Body = z.object({
    userId: z.string().uuid(),
    amount_credits: z.number().int().positive(),
});

const tenantId = process.env.FLOW402_TENANT_ID;
const routePath = "/api/topup/mock";
const idempotencyHeader = "idempotency-key";

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    // DEBUG - Must be FIRST thing in the function
    console.log(`[${requestId}] === TOPUP API CALLED ===`);
    console.log("ENV check:", {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length,
        allEnvKeys: Object.keys(process.env).filter((k) => k.includes("SUPABASE")),
    });

    if (!tenantId) {
        console.error("FLOW402_TENANT_ID missing for top-up mock route");
        return NextResponse.json(
            { ok: false, error: "tenant_not_configured" },
            { status: 500 }
        );
    }

    const idempotencyKey = req.headers.get(idempotencyHeader)?.trim() ?? "";
    if (!idempotencyKey) {
        console.warn(`[${requestId}] Missing Idempotency-Key header`);
        return NextResponse.json({ ok: false, error: "missing_idempotency_key" }, { status: 400 });
    }

    const rawBody = await req.text();
    let parsedBody: z.infer<typeof Body> | null = null;
    let claimed = false;
    let idempotencyStore: IdempotencyStore | null = null;

    try {
        console.log("Creating Supabase client...");

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        idempotencyStore = new IdempotencyStore(supabase);

        const claim = await idempotencyStore.claim({
            id: idempotencyKey,
            method: req.method,
            path: routePath,
            bodySha: hashBody(rawBody),
        });

        if (claim.type === "replay") {
            console.log(`[${requestId}] Replaying top-up response for key ${idempotencyKey}`);
            return NextResponse.json(claim.body, { status: claim.status });
        }

        if (claim.type === "conflict") {
            console.warn(`[${requestId}] Top-up idempotency conflict`, { reason: claim.reason });
            return NextResponse.json(
                { ok: false, error: "idempotency_conflict", reason: claim.reason },
                { status: 409 }
            );
        }

        if (claim.type === "locked") {
            console.warn(`[${requestId}] Top-up request already in progress`, { key: idempotencyKey });
            return NextResponse.json(
                { ok: false, error: "request_in_progress" },
                { status: 409 }
            );
        }

        claimed = true;

        parsedBody = Body.parse(rawBody ? JSON.parse(rawBody) : {});
        const { userId, amount_credits } = parsedBody;

        // Call your SQL function to increment balance
        const { error } = await supabase.rpc("increment_balance", {
            p_tenant: tenantId,
            p_user: userId,
            p_amount: amount_credits,
            p_kind: "topup",
            p_ref: `dashboard_topup_${Date.now()}`,
        });

        if (error) throw error;

        return respondWithIdempotency(
            idempotencyStore,
            idempotencyKey,
            claimed,
            { ok: true },
            200,
            requestId
        );
    } catch (error) {
        console.error(`[${requestId}] Mock top-up error:`, error);

        if (error instanceof SyntaxError) {
            return respondWithIdempotency(
                idempotencyStore,
                idempotencyKey,
                claimed,
                { ok: false, error: "invalid_request", details: "Malformed JSON" },
                400,
                requestId
            );
        }

        if (error instanceof z.ZodError) {
            return respondWithIdempotency(
                idempotencyStore,
                idempotencyKey,
                claimed,
                { ok: false, error: "invalid_request", details: error.flatten() },
                400,
                requestId
            );
        }

        if (claimed && idempotencyStore) {
            try {
                await idempotencyStore.release(idempotencyKey);
            } catch (releaseError) {
                console.error(
                    `[${requestId}] Failed to release idempotency key ${idempotencyKey}`,
                    releaseError
                );
            }
        }

        const details = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: "topup_failed", details }, { status: 500 });
    }
}

async function respondWithIdempotency(
    store: IdempotencyStore | null,
    key: string,
    shouldPersist: boolean,
    payload: Record<string, unknown>,
    status: number,
    requestId: string
) {
    if (shouldPersist && store) {
        try {
            await store.persistResponse(key, status, payload);
        } catch (persistError) {
            console.error(
                `[${requestId}] Failed to persist idempotency response for ${key}`,
                persistError
            );
        }
    }

    return NextResponse.json(payload, { status });
}
