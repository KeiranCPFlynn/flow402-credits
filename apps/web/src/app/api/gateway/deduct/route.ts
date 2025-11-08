import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Validate the expected JSON body
const Body = z.object({
    userId: z.string().uuid(),
    ref: z.string().min(6),
    amount_credits: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
    console.log("💡 /api/gateway/deduct called");

    try {
        const { userId, ref, amount_credits } = Body.parse(await req.json());
        console.log("➡️ Request body:", { userId, ref, amount_credits });

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Get current balance
        const { data: credit, error: balanceError } = await supabase
            .from("credits")
            .select("balance_cents")
            .eq("user_id", userId)
            .single();

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

        // Deduct credits and insert into ledger
        const newBalance = currentCredits - amount_credits;

        const { error: updateError } = await supabase
            .from("credits")
            .update({ balance_cents: newBalance })
            .eq("user_id", userId);

        if (updateError) {
            console.error("❌ Deduction update failed:", updateError.message);
            throw updateError;
        }

        await supabase.from("tx_ledger").insert({
            user_id: userId,
            kind: "deduct",
            amount_cents: amount_credits,
            ref,
        });

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
