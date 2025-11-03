import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const Body = z.object({
    userId: z.string().uuid().optional(),
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const demoUserId = process.env.DEMO_USER_ID || "9c0383a1-0887-4c0f-98ca-cb71ffc4e76c";

export async function POST(req: NextRequest) {
    try {
        const body = Body.parse(await req.json().catch(() => ({})));
        const userId = body.userId ?? demoUserId;

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: currentBalance, error: fetchError } = await supabase
            .from("credits")
            .select("balance_cents")
            .eq("user_id", userId)
            .single();

        if (fetchError) {
            console.error("Reset balance fetch error:", fetchError);
            return NextResponse.json(
                { ok: false, error: "balance_fetch_failed" },
                { status: 500 }
            );
        }

        const { error: updateError } = await supabase
            .from("credits")
            .update({ balance_cents: 0 })
            .eq("user_id", userId);

        if (updateError) {
            console.error("Reset balance update error:", updateError);
            return NextResponse.json(
                { ok: false, error: "balance_reset_failed" },
                { status: 500 }
            );
        }

        const { error: ledgerError } = await supabase.from("tx_ledger").insert({
            user_id: userId,
            kind: "reset",
            amount_cents: currentBalance?.balance_cents ?? 0,
            ref: `manual_reset_${Date.now()}`,
        });

        if (ledgerError) {
            console.error("Reset balance ledger insert error:", ledgerError);
            return NextResponse.json(
                { ok: false, error: "ledger_insert_failed" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            previous_balance_cents: currentBalance?.balance_cents ?? 0,
            new_balance_cents: 0,
        });
    } catch (error) {
        console.error("Reset balance route error:", error);
        return NextResponse.json(
            { ok: false, error: "unexpected_error" },
            { status: 500 }
        );
    }
}
