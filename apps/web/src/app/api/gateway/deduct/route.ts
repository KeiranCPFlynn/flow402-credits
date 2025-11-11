import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Flow402Dal } from "@/lib/dal";
import { isFlow402Error } from "@/lib/flow402-error";
import { hashBody, verify } from "@/lib/hmac";
import { IdempotencyStore } from "@/lib/idempotency";

// Validate the expected JSON body
const Body = z.object({
    userId: z.string().uuid(),
    ref: z.string().min(6),
    amount_credits: z.number().int().positive(),
});

const tenantId = process.env.FLOW402_TENANT_ID;
const routePath = "/api/gateway/deduct";
const idempotencyHeader = "idempotency-key";

export async function POST(req: NextRequest) {
    console.log("💡 /api/gateway/deduct called");
    const requestId = randomUUID();

    if (!tenantId) {
        console.error("❌ FLOW402_TENANT_ID missing");
        return NextResponse.json(
            { ok: false, error: "tenant_not_configured" },
            { status: 500 }
        );
    }

    const vendorKeyHeader = req.headers.get("x-f402-key");
    const vendorKey = vendorKeyHeader?.trim();
    if (!vendorKey) {
        console.warn(`[${requestId}] Missing x-f402-key header`);
        return invalidSignatureResponse(requestId, "missing_vendor_key");
    }

    const idempotencyKey = req.headers.get(idempotencyHeader)?.trim() ?? "";
    if (!idempotencyKey) {
        console.warn(`[${requestId}] Missing Idempotency-Key header`);
        return NextResponse.json(
            { ok: false, error: "missing_idempotency_key" },
            { status: 400 }
        );
    }

    let parsedBody: z.infer<typeof Body> | null = null;
    let claimed = false;
    let idempotencyStore: IdempotencyStore | null = null;

    try {
        const scopedTenantId = tenantId as string;
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const dal = new Flow402Dal(supabase);
        idempotencyStore = new IdempotencyStore(supabase);

        const vendor = await dal
            .getVendorByKey(vendorKey)
            .catch((lookupError) => {
                if (isFlow402Error(lookupError) && lookupError.code === "vendor_not_found") {
                    console.warn(`[${requestId}] Vendor lookup failed`, lookupError);
                    return null;
                }

                throw lookupError;
            });

        if (!vendor) {
            return invalidSignatureResponse(requestId, "unknown_vendor");
        }
        if (vendor.id !== scopedTenantId) {
            console.warn(`[${requestId}] Vendor mismatch`, { vendor: vendor.id, tenantId: scopedTenantId });
            return invalidSignatureResponse(requestId, "vendor_mismatch");
        }

        const verification = await verify(req, vendor.signing_secret);
        if (!verification.ok) {
            console.warn(`[${requestId}] Signature verification failed`, { reason: verification.reason });
            return invalidSignatureResponse(requestId, verification.reason);
        }

        const bodySha = hashBody(verification.body);
        const claim = await idempotencyStore.claim({
            id: idempotencyKey,
            method: req.method,
            path: routePath,
            bodySha,
        });

        if (claim.type === "replay") {
            console.log(`[${requestId}] Replaying response for idempotent key ${idempotencyKey}`);
            return NextResponse.json(claim.body, { status: claim.status });
        }

        if (claim.type === "conflict") {
            console.warn(`[${requestId}] Idempotency conflict`, { reason: claim.reason });
            return NextResponse.json(
                { ok: false, error: "idempotency_conflict", reason: claim.reason },
                { status: 409 }
            );
        }

        if (claim.type === "locked") {
            console.warn(`[${requestId}] Idempotency key currently processing`, { key: idempotencyKey });
            return NextResponse.json(
                { ok: false, error: "request_in_progress" },
                { status: 409 }
            );
        }

        claimed = true;

        parsedBody = Body.parse(JSON.parse(verification.body));
        const { userId, ref, amount_credits } = parsedBody;
        console.log("➡️ Request body:", { userId, ref, amount_credits });

        const vendorUser = await dal.ensureVendorUser(scopedTenantId, userId);
        const balance = await dal.getBalance(scopedTenantId, vendorUser.user_id);

        console.log(`💰 Current balance: ${balance.credits} credits`);

        // Not enough credits → trigger 402 response
        if (balance.credits < amount_credits) {
            console.log("⚠️ Insufficient credits, returning 402");
            return respondWithIdempotency(
                idempotencyStore,
                idempotencyKey,
                claimed,
                {
                    price_credits: amount_credits,
                    currency: "USDC",
                    topup_url: `/topup?need=${amount_credits}&user=${userId}`,
                },
                402,
                requestId
            );
        }

        const newBalance = await dal.incrementBalance({
            vendorId: scopedTenantId,
            vendorUserId: vendorUser.user_id,
            deltaCredits: -amount_credits,
            kind: "debit",
            ref,
            route: routePath,
            meta: { attempted_amount: amount_credits },
        });

        console.log("✅ Deduct successful, new balance:", newBalance);

        return respondWithIdempotency(
            idempotencyStore,
            idempotencyKey,
            claimed,
            { ok: true, new_balance: newBalance },
            200,
            requestId
        );
    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error(`[${requestId}] ❌ Invalid JSON payload`, error);
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
            console.error(`[${requestId}] ❌ Invalid gateway request payload`, error);
            return respondWithIdempotency(
                idempotencyStore,
                idempotencyKey,
                claimed,
                { ok: false, error: "invalid_request", details: error.flatten() },
                400,
                requestId
            );
        }

        if (isFlow402Error(error)) {
            console.error(`[${requestId}] ❌ Flow402 error (${error.code}):`, error);

            if (error.code === "insufficient_funds") {
                return respondWithIdempotency(
                    idempotencyStore,
                    idempotencyKey,
                    claimed,
                    {
                        price_credits: parsedBody?.amount_credits ?? 0,
                        currency: "USDC",
                        topup_url: `/topup?need=${parsedBody?.amount_credits ?? 0}&user=${parsedBody?.userId ?? "unknown"}`,
                    },
                    402,
                    requestId
                );
            }

            return respondWithIdempotency(
                idempotencyStore,
                idempotencyKey,
                claimed,
                { ok: false, error: error.code, details: error.message },
                error.status,
                requestId
            );
        }

        console.error(`[${requestId}] ❌ Gateway deduct route error:`, error);

        if (claimed && idempotencyStore) {
            try {
                await idempotencyStore.release(idempotencyKey);
            } catch (releaseError) {
                console.error(
                    `[${requestId}] ❌ Failed to release idempotency key ${idempotencyKey}`,
                    releaseError
                );
            }
        }

        return NextResponse.json({ ok: false, error: "unknown_error" }, { status: 500 });
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
                `[${requestId}] ❌ Failed to persist idempotency response for ${key}`,
                persistError
            );
        }
    }

    return NextResponse.json(payload, { status });
}

function invalidSignatureResponse(requestId: string, reason: string) {
    return NextResponse.json(
        { error: "invalid_signature", reason, request_id: requestId },
        { status: 401 }
    );
}
