import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

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

    try {
        const scopedTenantId = tenantId as string;
        const { userId, ref, amount_credits } = Body.parse(await req.json());
        console.log("➡️ Request body:", { userId, ref, amount_credits });

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Get current balance scoped to the tenant
        const { data: credit, error: balanceError } = await supabase
            .from("credits")
            .select("balance_cents")
            .eq("tenant_id", scopedTenantId)
            .eq("user_id", userId)
            .maybeSingle();

        if (balanceError) {
            console.error("❌ Supabase balance fetch error:", balanceError.message);
            throw balanceError;
        }

        const currentCredits = credit?.balance_cents ?? 0;
        console.log(`💰 Current balance: ${currentCredits} credits`);

        // Not enough credits → trigger 402 response
        if (currentCredits < amount_credits) {
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

        const { data: rpcBalance, error: deductError } = await supabase.rpc(
            "deduct_balance",
            {
                p_tenant: scopedTenantId,
                p_user: userId,
                p_amount: amount_credits,
                p_ref: ref,
            }
        );

        if (deductError) {
            const message = deductError.message ?? "";
            if (message.includes("insufficient_funds")) {
                console.warn("⚠️ RPC reported insufficient funds after check");
                return NextResponse.json(
                    {
                        price_credits: amount_credits,
                        currency: "USDC",
                        topup_url: `/topup?need=${amount_credits}&user=${userId}`,
                    },
                    { status: 402 }
                );
            }

            console.error("❌ Deduct RPC failed:", deductError);
            throw deductError;
        }

        const newBalance =
            typeof rpcBalance === "number"
                ? rpcBalance
                : Number(rpcBalance ?? currentCredits - amount_credits);

        console.log("✅ Deduct successful, new balance:", newBalance);

        return NextResponse.json({ ok: true, new_balance: newBalance }, { status: 200 });
    } catch (e: any) {
        console.error("❌ Gateway deduct route error:", e);
        return NextResponse.json(
            { ok: false, error: String(e) },
            { status: 500 }
        );
    }
}
