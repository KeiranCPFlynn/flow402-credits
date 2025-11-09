import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { Flow402Dal } from "@/lib/dal";
import { isFlow402Error } from "@/lib/flow402-error";

// Validate the expected JSON body
const Body = z.object({
    userId: z.string().uuid(),
    ref: z.string().min(6),
    amount_credits: z.number().int().positive(),
});

const tenantId = process.env.FLOW402_TENANT_ID;

export async function POST(req: NextRequest) {
    console.log("💡 /api/gateway/deduct called");

    if (!tenantId) {
        console.error("❌ FLOW402_TENANT_ID missing");
        return NextResponse.json(
            { ok: false, error: "tenant_not_configured" },
            { status: 500 }
        );
    }

    let parsedBody: z.infer<typeof Body> | null = null;

    try {
        const scopedTenantId = tenantId as string;
        parsedBody = Body.parse(await req.json());
        const { userId, ref, amount_credits } = parsedBody;
        console.log("➡️ Request body:", { userId, ref, amount_credits });

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const dal = new Flow402Dal(supabase);

        const vendorUser = await dal.ensureVendorUser(scopedTenantId, userId);
        const balance = await dal.getBalance(scopedTenantId, vendorUser.user_id);

        console.log(`💰 Current balance: ${balance.credits} credits`);

        // Not enough credits → trigger 402 response
        if (balance.credits < amount_credits) {
            console.log("⚠️ Insufficient credits, returning 402");
            return NextResponse.json(
                {
                    price_credits: amount_credits,
                    currency: "USDC",
                    topup_url: `/topup?need=${amount_credits}&user=${userId}`,
                },
                { status: 402 }
            );
        }

        const newBalance = await dal.incrementBalance({
            vendorId: scopedTenantId,
            vendorUserId: vendorUser.user_id,
            deltaCredits: -amount_credits,
            kind: "debit",
            ref,
            route: "/api/gateway/deduct",
            meta: { attempted_amount: amount_credits },
        });

        console.log("✅ Deduct successful, new balance:", newBalance);

        return NextResponse.json({ ok: true, new_balance: newBalance }, { status: 200 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("❌ Invalid gateway request payload", error);
            return NextResponse.json(
                { ok: false, error: "invalid_request", details: error.flatten() },
                { status: 400 }
            );
        }

        if (isFlow402Error(error)) {
            console.error(`❌ Flow402 error (${error.code}):`, error);

            if (error.code === "insufficient_funds") {
                return NextResponse.json(
                    {
                        price_credits: parsedBody?.amount_credits ?? 0,
                        currency: "USDC",
                        topup_url: `/topup?need=${parsedBody?.amount_credits ?? 0}&user=${parsedBody?.userId ?? "unknown"}`,
                    },
                    { status: 402 }
                );
            }

            return NextResponse.json(
                { ok: false, error: error.code, details: error.message },
                { status: error.status }
            );
        }

        console.error("❌ Gateway deduct route error:", error);
        return NextResponse.json({ ok: false, error: "unknown_error" }, { status: 500 });
    }
}
